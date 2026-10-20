import { describe, expect, it } from 'vitest';
import {
  buildBrandExecutionContract,
  buildPreviousSlidesRefineBlock,
  nextSlideCountAfterScreenshotChange,
  type PromptWriterInput,
  type PromptWriterSlide,
} from '../../components/AIImageStudio/promptWriterService';
import type { BrandKnowledge } from '../../components/AIImageStudio/types';

const baseInput: PromptWriterInput = {
  userInstruction: 'Create an educational matcha carousel',
  composerReferences: [],
  assets: [],
  aspectRatio: '4:5',
  slideCount: 5,
  useWebSearch: false,
};

function makeBrandKnowledge(overrides: Partial<BrandKnowledge> = {}): BrandKnowledge {
  return {
    id: 'brand-1',
    brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
    sourceUrls: [],
    sources: [],
    fonts: [
      {
        value: {
          family: 'Neue Haas Grotesk',
          role: 'heading',
          weights: [700],
          source: 'website_css',
        },
        status: 'verified',
        confidence: 1,
        sourceIds: [],
      },
      {
        value: {
          family: 'Inter',
          role: 'body',
          weights: [400, 600],
          source: 'google_fonts',
        },
        status: 'verified',
        confidence: 1,
        sourceIds: [],
      },
    ],
    colors: [
      { value: '#0f3d2e', status: 'verified', confidence: 1, sourceIds: [] },
      { value: '#f7f1df', status: 'verified', confidence: 1, sourceIds: [] },
      { value: '#c7a45b', status: 'inferred', confidence: 0.8, sourceIds: [] },
    ],
    logoRules: [{ value: 'Use wordmark only on quiet backgrounds', status: 'verified', confidence: 1, sourceIds: [] }],
    visualPrinciples: [
      { value: 'premium Japanese minimalism', status: 'verified', confidence: 1, sourceIds: [] },
      { value: 'generous negative space', status: 'verified', confidence: 1, sourceIds: [] },
    ],
    toneAttributes: [{ value: 'calm expert', status: 'verified', confidence: 1, sourceIds: [] }],
    approvedLanguage: [],
    prohibitedLanguage: [],
    imageStyle: {
      lighting: [{ value: 'soft natural side light', status: 'verified', confidence: 1, sourceIds: [] }],
      composition: [{ value: 'centered product with editorial margins', status: 'verified', confidence: 1, sourceIds: [] }],
      backgrounds: [{ value: 'warm rice-paper neutrals', status: 'verified', confidence: 1, sourceIds: [] }],
      textures: [{ value: 'ceramic and handmade paper', status: 'verified', confidence: 1, sourceIds: [] }],
    },
    updatedAt: '2026-06-22T00:00:00.000Z',
    ...overrides,
  };
}

describe('buildBrandExecutionContract', () => {
  it('turns brand knowledge into concrete art-direction requirements', () => {
    const contract = buildBrandExecutionContract({
      ...baseInput,
      brandKnowledge: makeBrandKnowledge(),
    });

    expect(contract).toContain('Kageha');
    expect(contract).toContain('#0f3d2e');
    expect(contract).toContain('#f7f1df');
    expect(contract).toContain('Neue Haas Grotesk');
    expect(contract).toContain('Inter');
    expect(contract).toContain('premium Japanese minimalism');
    expect(contract).toContain('soft natural side light');
    expect(contract).toContain('consistent grid');
    expect(contract).toContain('mismatched fonts');
    expect(contract).toContain('Do not introduce unrelated neon');
  });

  it('still demands a professional system when no brand knowledge exists', () => {
    const contract = buildBrandExecutionContract(baseInput);

    expect(contract).toContain('No verified brand system is available');
    expect(contract).toContain('one restrained palette');
    expect(contract).toContain('one typography pairing');
    expect(contract).toContain('exact colors');
  });
});

describe('buildPreviousSlidesRefineBlock', () => {
  it('includes full prior prompts instead of truncating to 400 chars', () => {
    const longPrompt = 'A'.repeat(900);
    const slides: PromptWriterSlide[] = [
      {
        slideNumber: 1,
        title: 'Hook',
        prompt: longPrompt,
        negativePrompt: 'blurry text',
        copy: { headline: 'Calm energy', caption: 'Sip slowly' },
        designNotes: 'Keep product centered',
      },
    ];

    const block = buildPreviousSlidesRefineBlock(slides, 'Make the lighting warmer');

    expect(block).toContain(longPrompt);
    expect(block).not.toContain(`${'A'.repeat(400)}...`);
    expect(block).toContain('Negative prompt:\nblurry text');
    expect(block).toContain('Calm energy');
    expect(block).toContain('Make the lighting warmer');
    expect(block).toContain('Keep product centered');
  });
});

describe('nextSlideCountAfterScreenshotChange', () => {
  it('syncs to screenshot count when still unlocked and previously in sync', () => {
    expect(
      nextSlideCountAfterScreenshotChange({
        nextScreenshotCount: 5,
        prevScreenshotCount: 0,
        currentSlideCount: 1,
        userLocked: false,
      }),
    ).toBe(5);

    expect(
      nextSlideCountAfterScreenshotChange({
        nextScreenshotCount: 4,
        prevScreenshotCount: 5,
        currentSlideCount: 5,
        userLocked: false,
      }),
    ).toBe(4);
  });

  it('does not override a manual slide count', () => {
    expect(
      nextSlideCountAfterScreenshotChange({
        nextScreenshotCount: 5,
        prevScreenshotCount: 2,
        currentSlideCount: 3,
        userLocked: true,
      }),
    ).toBe(3);
  });

  it('does not force sync when slides were already out of sync', () => {
    expect(
      nextSlideCountAfterScreenshotChange({
        nextScreenshotCount: 6,
        prevScreenshotCount: 5,
        currentSlideCount: 2,
        userLocked: false,
      }),
    ).toBe(2);
  });
});
