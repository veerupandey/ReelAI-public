import { describe, it, expect, vi, beforeAll } from 'vitest';
import { inferSlideLayout, extractBrandColors, extractFontStyles, type CarouselOverlayConfig } from '../services/carouselOverlayService';

// Polyfill canvas for Node.js test environment
class MockCanvasRenderingContext2D {
  fillRect() {}
  fillText() {}
  measureText() { return { width: 100 }; }
  drawImage() {}
  beginPath() {}
  arcTo() {}
  closePath() {}
  fill() {}
  roundRect() {}
  createLinearGradient() { return { addColorStop: () => {} }; }
  set fillStyle(_v: string) {}
  set font(_v: string) {}
  set textAlign(_v: string) {}
  set textBaseline(_v: string) {}
  set shadowColor(_v: string) {}
  set shadowBlur(_v: number) {}
  set shadowOffsetY(_v: number) {}
  get fillStyle(): string { return ''; }
  get font(): string { return ''; }
}

beforeAll(() => {
  // Mock canvas for Node environment
  (global as any).document = {
    createElement: () => ({
      width: 1080,
      height: 1080,
      getContext: () => new MockCanvasRenderingContext2D(),
      toDataURL: () => 'data:image/png;base64,mockBase64Data',
    }),
  };
  (global as any).Image = class {
    crossOrigin = '';
    private _src = '';
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    width = 1080;
    height = 1080;
    set src(v: string) {
      this._src = v;
      // Simulate async image load
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  };
});

describe('carouselOverlayService', () => {
  describe('inferSlideLayout', () => {
    it('returns "hook" for first slide when total > 3', () => {
      expect(inferSlideLayout(0, 7)).toBe('hook');
    });

    it('returns "cover" for first slide when total <= 3', () => {
      expect(inferSlideLayout(0, 3)).toBe('cover');
    });

    it('returns "cta" for last slide', () => {
      expect(inferSlideLayout(6, 7)).toBe('cta');
    });

    it('returns "value" for middle slides', () => {
      expect(inferSlideLayout(3, 7)).toBe('value');
      expect(inferSlideLayout(1, 5)).toBe('value');
    });
  });

  describe('extractBrandColors', () => {
    it('extracts colors from BrandDNA', () => {
      const colors = extractBrandColors({
        colors: {
          primary: '#FF0000',
          secondary: '#00FF00',
          accent: '#0000FF',
          palette: ['#FF0000', '#00FF00', '#0000FF'],
        },
      });
      expect(colors.primary).toBe('#FF0000');
      expect(colors.accent).toBe('#0000FF');
      // #FF0000 has luminance 0.299 (dark), so text should be white for contrast
      expect(colors.text).toBe('#FFFFFF');
    });

    it('falls back to secondary for accent', () => {
      const colors = extractBrandColors({
        colors: {
          primary: '#FF0000',
          secondary: '#00FF00',
        },
      });
      expect(colors.accent).toBe('#00FF00');
    });

    it('falls back to primary for accent', () => {
      const colors = extractBrandColors({
        colors: {
          primary: '#FF0000',
        },
      });
      expect(colors.accent).toBe('#FF0000');
    });

    it('defaults to white when no colors provided', () => {
      const colors = extractBrandColors({});
      expect(colors.primary).toBe('#FFFFFF');
      expect(colors.accent).toBe('#FFFFFF');
      // #FFFFFF is light, so text should be dark
      expect(colors.text).toBe('#1A1A1A');
    });

    it('uses dark text for light brand colors', () => {
      const colors = extractBrandColors({
        colors: { primary: '#FFEEAA', accent: '#FFCC00' },
      });
      // #FFEEAA has luminance ~0.93 (very light), so text should be dark
      expect(colors.text).toBe('#1A1A1A');
    });
  });

  describe('extractFontStyles', () => {
    it('extracts font styles from typography', () => {
      const styles = extractFontStyles({
        headingStyle: 'Simple neutral sans',
        bodyStyle: 'Regular serif',
      });
      // 'simple' + 'sans' matches the sans-serif font map entry
      expect(styles.headingFamily).toContain('Helvetica');
      expect(styles.headingWeight).toBe('700');
      expect(styles.bodyWeight).toBe('400');
    });

    it('maps serif typography to serif font family', () => {
      const styles = extractFontStyles({
        headingStyle: 'Elegant serif',
        bodyStyle: 'Classic editorial',
      });
      expect(styles.headingFamily).toContain('Playfair Display');
      expect(styles.headingWeight).toBe('700');
    });

    it('maps bold/impact typography to condensed font family', () => {
      const styles = extractFontStyles({
        headingStyle: 'Bold impact condensed',
      });
      expect(styles.headingFamily).toContain('Arial Narrow');
      expect(styles.headingWeight).toBe('800');
    });

    it('returns defaults when no typography provided', () => {
      const styles = extractFontStyles();
      expect(styles.headingWeight).toBe('700');
      expect(styles.bodyWeight).toBe('400');
    });
  });

  describe('burnCarouselOverlay', () => {
    it('burns overlay and returns base64 + previewUrl', async () => {
      const { burnCarouselOverlay } = await import('../services/carouselOverlayService');
      const config: CarouselOverlayConfig = {
        headline: 'Test Headline',
        bodyText: 'Test body text',
        slideNumber: { current: 1, total: 5 },
        brandColors: {
          primary: '#FF0000',
          accent: '#0000FF',
          background: 'rgba(0,0,0,0.5)',
          text: '#FFFFFF',
        },
        fontStyles: {
          headingFamily: 'Arial',
          bodyFamily: 'Arial',
          headingWeight: '800',
          bodyWeight: '400',
        },
        layout: 'hook',
      };

      const result = await burnCarouselOverlay('mockBase64Data', config);
      expect(result.base64).toBe('mockBase64Data');
      expect(result.mimeType).toBe('image/png');
      expect(result.previewUrl).toContain('data:image/png');
    });
  });

  describe('resolveFontFamily', () => {
    it('maps serif descriptions to Playfair Display', async () => {
      const { resolveFontFamily } = await import('../services/geminiService');
      const fonts = resolveFontFamily({ headingStyle: 'elegant serif', bodyStyle: 'modern sans-serif' });
      expect(fonts.heading).toBe('Playfair Display');
      expect(fonts.body).toBe('Helvetica Neue');
    });

    it('maps modern sans to Helvetica Neue', async () => {
      const { resolveFontFamily } = await import('../services/geminiService');
      const fonts = resolveFontFamily({ headingStyle: 'modern clean sans-serif', bodyStyle: 'minimal' });
      expect(fonts.heading).toBe('Helvetica Neue');
    });

    it('defaults to Helvetica Neue when no match', async () => {
      const { resolveFontFamily } = await import('../services/geminiService');
      const fonts = resolveFontFamily(undefined);
      expect(fonts.heading).toBe('Helvetica Neue');
      expect(fonts.body).toBe('Helvetica Neue');
    });

    it('maps script/handwritten to Brush Script MT', async () => {
      const { resolveFontFamily } = await import('../services/geminiService');
      const fonts = resolveFontFamily({ headingStyle: 'handwritten script', bodyStyle: 'casual' });
      expect(fonts.heading).toBe('Brush Script MT');
    });
  });

  describe('carouselPromptWriterAdapter', () => {
    it('brandToBrandKnowledge maps brand DNA correctly', async () => {
      const { brandToBrandKnowledge } = await import('../services/carouselPromptWriterAdapter');
      const brand = {
        id: 'test', userId: 'test', name: 'Kageha', websiteUrl: 'https://kageha.com', createdAt: '', updatedAt: '',
        dna: { tagline: 'Matcha reimagined', valuePropositions: ['Antioxidant rich'], brandVoice: { tone: 'premium', personality: '', vocabulary: ['clean', 'natural'] }, colors: { primary: '#4a7c59', secondary: '', accent: '', palette: ['#4a7c59', '#fff'], reasoning: '' }, typography: { headingStyle: 'elegant serif', bodyStyle: 'modern sans-serif', characterTraits: '' }, visualSignature: 'minimal', aesthetic: ['clean', 'natural'], products: [], keyIngredients: [], targetAudience: { demographics: '', psychographics: '', painPoints: [] } } as any,
        assets: [], status: 'ready',
      } as any;

      const knowledge = brandToBrandKnowledge(brand);
      expect(knowledge.brandName.value).toBe('Kageha');
      expect(knowledge.colors.length).toBe(2);
      expect(knowledge.fonts.length).toBe(2);
      expect(knowledge.fonts[0].value.family).toBe('Playfair Display');
      expect(knowledge.fonts[1].value.family).toBe('Helvetica Neue');
      expect(knowledge.toneAttributes[0].value).toBe('premium');
      expect(knowledge.sourceUrls).toContain('https://kageha.com');
    });

    it('brandAssetsToStudioAssets maps assets correctly', async () => {
      const { brandAssetsToStudioAssets } = await import('../services/carouselPromptWriterAdapter');
      const assets = [
        { id: 'a1', type: 'product', base64: 'abc123', mimeType: 'image/png', description: 'Product shot', sourceProductTitle: 'Matcha' },
        { id: 'a2', type: 'lifestyle', base64: 'def456', mimeType: 'image/jpeg', description: 'Lifestyle', sourceProductTitle: 'Matcha' },
      ] as any;

      const studio = brandAssetsToStudioAssets(assets);
      expect(studio).toHaveLength(2);
      expect(studio[0].id).toBe('a1');
      expect(studio[0].base64).toBe('abc123');
      expect(studio[0].mimeType).toBe('image/png');
    });

    it('buildProductTruth creates preservation rules', async () => {
      const { buildProductTruth } = await import('../services/carouselPromptWriterAdapter');
      const assets = [
        { id: 'a1', type: 'product' },
        { id: 'a2', type: 'lifestyle' },
      ] as any;

      const truth = buildProductTruth('Kageha Matcha', assets);
      expect(truth.productName).toBe('Kageha Matcha');
      expect(truth.protectedAssetIds).toEqual(['a1']);
      expect(truth.preservationRules.length).toBeGreaterThan(0);
    });
  });
});
