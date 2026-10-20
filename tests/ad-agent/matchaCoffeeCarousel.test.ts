import { describe, expect, it } from 'vitest';
import { buildEvidenceGraph } from '../../services/adIntelligence/evidenceGraph';
import { gateCreativeScenes } from '../../services/adIntelligence/evidenceGate';
import { hasDuplicateCreativeScenes } from '../../services/autonomousAgent';

const productGraph = buildEvidenceGraph({
  productUrl: 'https://kageha.ca/products/signature-ceremonial-matcha',
  productTitle: 'Kageha Signature Ceremonial Matcha',
  facts: [
    'Single-origin matcha from Uji, Japan.',
    'Shade-grown for 21 days and stone-milled.',
    'Prepared by sifting, whisking with water, and sipping.',
    'Smooth body, vivid green color, long clean finish, and no bitterness.',
    'Published composition data estimates approximately 70 mg caffeine per 2 g serving; values vary.',
  ],
});

const slides = [
  {
    index: 0,
    imagePrompt: 'Split-screen morning choice: Kageha matcha bowl and a plain black coffee cup, editorial overhead composition.',
    voiceoverText: '',
    slideHeadline: 'Matcha or Coffee?',
    slideBody: 'Two caffeinated rituals. Two very different experiences.',
  },
  {
    index: 1,
    imagePrompt: 'Kageha tin beside a precise 2 g serving and a restrained caffeine comparison graphic.',
    voiceoverText: '',
    slideHeadline: 'Know Your Cup',
    slideBody: 'About 70 mg caffeine per 2 g; coffee varies by brew.',
  },
  {
    index: 2,
    imagePrompt: 'Sequence of fine matcha falling through a sifter, bamboo whisk creating foam, and hands holding the bowl.',
    voiceoverText: '',
    slideHeadline: 'Sift. Whisk. Sip.',
    slideBody: 'A two-minute preparation ritual, not a push-button pour.',
  },
  {
    index: 3,
    imagePrompt: 'Macro vivid green foam and ceramic bowl contrasted with roasted coffee tones, premium sensory photography.',
    voiceoverText: '',
    slideHeadline: 'Choose The Experience',
    slideBody: 'Smooth, vivid and clean-finishing, with no bitterness.',
  },
  {
    index: 4,
    imagePrompt: 'Exact Kageha Signature Ceremonial tin beside a finished water-only bowl, clean CTA-safe negative space.',
    voiceoverText: '',
    slideHeadline: 'Try The Slow Bowl',
    slideBody: 'Discover Signature Ceremonial from Uji, Japan.',
  },
];

describe('Kageha matcha vs coffee comparison carousel', () => {
  it('uses five distinct, swipe-native slides', () => {
    expect(slides).toHaveLength(5);
    expect(hasDuplicateCreativeScenes(slides)).toBe(false);
    expect(slides[0].slideHeadline).toMatch(/matcha.*coffee/i);
    expect(slides.at(-1)?.slideHeadline).toMatch(/try/i);
  });

  it('keeps copy within carousel limits', () => {
    for (const slide of slides) {
      expect(slide.slideHeadline.split(/\s+/).length).toBeLessThanOrEqual(5);
      expect(slide.slideBody.split(/\s+/).length).toBeLessThanOrEqual(12);
    }
  });

  it('passes product evidence safety checks', () => {
    const result = gateCreativeScenes(slides, productGraph);
    expect(result.approved).toBe(true);
    expect(result.issues).toEqual([]);
  });

  it('does not make unsupported superiority or health claims', () => {
    const copy = slides.map((slide) => `${slide.slideHeadline} ${slide.slideBody}`).join(' ');
    expect(copy).not.toMatch(/healthier|better than|no crash|boosts metabolism|cures|prevents/i);
  });
});
