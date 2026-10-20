import { describe, expect, it } from 'vitest';
import { buildBrandAestheticsBrief } from '../../components/AIImageStudio/creativeContextService';
import type { BrandKnowledge } from '../../components/AIImageStudio/types';

function makeBrand(overrides: Partial<BrandKnowledge> = {}): BrandKnowledge {
  return {
    id: 'brand-1',
    brandName: { value: 'Kageha', status: 'accepted' },
    sourceUrls: ['https://kageha.ca/'],
    sources: [],
    toneAttributes: [{ value: 'calm', status: 'accepted' }],
    visualPrinciples: [{ value: 'minimal ritual', status: 'accepted' }],
    colors: [{ value: '#4a7c59', status: 'accepted' }],
    approvedLanguage: [{ value: 'ceremony', status: 'accepted' }],
    fonts: [{ value: { family: 'Inter', role: 'heading' }, status: 'accepted' }],
    logoRules: [{ value: 'clear space', status: 'accepted' }],
    prohibitedLanguage: [{ value: 'cheap', status: 'accepted' }],
    imageStyle: {
      lighting: [{ value: 'soft window', status: 'accepted' }],
      composition: [{ value: 'centered hero', status: 'accepted' }],
      backgrounds: [{ value: 'warm wood', status: 'accepted' }],
      textures: [{ value: 'ceramic', status: 'accepted' }],
    },
    updatedAt: new Date().toISOString(),
    ...overrides,
  } as BrandKnowledge;
}

describe('buildBrandAestheticsBrief', () => {
  it('returns empty string without brand knowledge', () => {
    expect(buildBrandAestheticsBrief(undefined)).toBe('');
    expect(buildBrandAestheticsBrief(null)).toBe('');
  });

  it('includes palette, type, lighting, and tone', () => {
    const brief = buildBrandAestheticsBrief(makeBrand());
    expect(brief).toContain('Brand: Kageha');
    expect(brief).toContain('Palette: #4a7c59');
    expect(brief).toContain('Typography: Inter (heading)');
    expect(brief).toContain('Lighting: soft window');
    expect(brief).toContain('Tone: calm');
  });

  it('omits rejected evidence values', () => {
    const brief = buildBrandAestheticsBrief(
      makeBrand({
        colors: [{ value: '#ff0000', status: 'rejected' }],
        toneAttributes: [{ value: 'loud', status: 'rejected' }],
      }),
    );
    expect(brief).not.toContain('#ff0000');
    expect(brief).not.toContain('loud');
    expect(brief).toContain('Brand: Kageha');
  });
});
