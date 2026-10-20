import { describe, it, expect } from 'vitest';
import {
  base64ToUint8Array,
  buildZipBlob,
  buildZipBytes,
  readStoredZipEntries,
} from '../../components/AIImageStudio/zipStore';
import {
  buildExportCaptionsText,
  buildRightsNotesText,
  buildBrandReportMarkdown,
  buildExportZipEntries,
  resolveExportBase64,
  safeExportFilename,
} from '../../components/AIImageStudio/exportPackService';
import type { StudioAsset, SocialPostDraft, BrandKnowledge } from '../../components/AIImageStudio/types';

describe('export pack + zip', () => {
  it('builds a valid zip blob with local and central headers', () => {
    const input = [
      { path: 'captions.txt', data: new TextEncoder().encode('hello') },
      { path: 'images/01.png', data: new Uint8Array([1, 2, 3, 4]) },
    ];
    const blob = buildZipBlob(input);
    expect(blob.type).toBe('application/zip');
    expect(blob.size).toBeGreaterThan(40);

    const extracted = readStoredZipEntries(buildZipBytes(input));
    expect(extracted.map((entry) => entry.path)).toEqual([
      'captions.txt',
      'images/01.png',
    ]);
    expect(new TextDecoder().decode(extracted[0].data)).toBe('hello');
    expect(Array.from(extracted[1].data)).toEqual([1, 2, 3, 4]);
  });

  it('rejects corrupt zip payloads', () => {
    const bytes = buildZipBytes([
      { path: 'captions.txt', data: new TextEncoder().encode('hello') },
    ]);
    bytes[bytes.indexOf('h'.charCodeAt(0))] ^= 0xff;
    expect(() => readStoredZipEntries(bytes)).toThrow(/CRC mismatch/);
  });

  it('decodes base64 payloads', () => {
    expect(Array.from(base64ToUint8Array(btoa('abc')))).toEqual([97, 98, 99]);
  });

  it('sanitizes export filenames', () => {
    expect(safeExportFilename('My Image!!', 'fallback')).toBe('My_Image');
    expect(safeExportFilename('@@@', 'fallback')).toBe('fallback');
  });

  it('resolves export bytes from data-URL preview when base64 is empty', () => {
    const asset: StudioAsset = {
      id: 'a1',
      name: 'Hero',
      description: '',
      base64: '',
      mimeType: 'image/png',
      width: 1,
      height: 1,
      source: 'upload',
      createdAt: new Date().toISOString(),
      previewUrl: `data:image/png;base64,${btoa('abc')}`,
    };
    expect(resolveExportBase64(asset)).toBe(btoa('abc'));
    const entries = buildExportZipEntries({ assets: [asset], brandName: 'Glow' });
    expect(entries.some((e) => e.path.startsWith('images/'))).toBe(true);
  });

  it('rejects export when only remote previewUrls are present', () => {
    expect(() =>
      buildExportZipEntries({
        assets: [
          {
            id: 'a1',
            name: 'Remote',
            description: '',
            base64: '',
            mimeType: 'image/jpeg',
            width: 1,
            height: 1,
            source: 'url_import',
            createdAt: new Date().toISOString(),
            previewUrl: 'https://cdn.example.com/a.jpg',
          },
        ],
      }),
    ).toThrow(/No exportable image data/);
  });

  it('includes social captions and asset prompts in captions.txt', () => {
    const assets: StudioAsset[] = [
      {
        id: 'a1',
        name: 'Hero Shot',
        description: '',
        base64: 'aaa',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'generated',
        createdAt: new Date().toISOString(),
        generationPrompt: 'premium lifestyle product shot',
        aspectRatio: '4:5',
      },
    ];
    const draft: SocialPostDraft = {
      id: 'd1',
      platform: 'instagram_feed',
      objective: 'awareness',
      heroAssetId: 'a1',
      supportingAssetIds: [],
      aspectRatio: '4:5',
      layout: { templateId: 't1', safeZones: [] },
      typography: {},
      copy: {
        headline: 'Taste the calm',
        caption: 'Sip slowly. Feel better.',
        hashtags: ['matcha', 'wellness'],
      },
      generationBrief: 'brief',
    };

    const text = buildExportCaptionsText({
      assets,
      socialPostDraft: draft,
      brandName: 'Kageha',
    });

    expect(text).toContain('Kageha');
    expect(text).toContain('Taste the calm');
    expect(text).toContain('Sip slowly. Feel better.');
    expect(text).toContain('#matcha');
    expect(text).toContain('premium lifestyle product shot');
  });

  it('builds client pack entries with sizes, rights, and brand report', () => {
    const assets: StudioAsset[] = [
      {
        id: 'a1',
        name: 'Hero',
        description: '',
        base64: btoa('img'),
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'generated',
        createdAt: new Date().toISOString(),
        variationSetId: 'set-1',
        variationIndex: 1,
        brandCompliance: {
          score: 88,
          status: 'pass',
          summary: 'On brand',
          checks: [],
          evaluatedAt: new Date().toISOString(),
          evaluationMode: 'limited',
        },
      },
    ];
    const knowledge: BrandKnowledge = {
      id: 'bk',
      brandName: { value: 'Glow', status: 'inferred', confidence: 0.8, sourceIds: [] },
      sourceUrls: [],
      sources: [],
      fonts: [],
      colors: [{ value: '#112233', status: 'inferred', confidence: 0.8, sourceIds: [] }],
      logoRules: [],
      visualPrinciples: [],
      toneAttributes: [],
      approvedLanguage: [],
      prohibitedLanguage: [],
      imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
      updatedAt: new Date().toISOString(),
    };

    const rights = buildRightsNotesText({
      assets,
      brandName: 'Glow',
      brandKnowledge: knowledge,
      clientPack: true,
    });
    expect(rights).toContain('Usage & Rights');
    expect(rights).toContain('#112233');

    const report = buildBrandReportMarkdown({
      assets,
      brandName: 'Glow',
      brandKnowledge: knowledge,
      clientPack: true,
    });
    expect(report).toContain('Variation set scorecards');
    expect(report).toContain('88/100');

    const entries = buildExportZipEntries({
      assets,
      brandName: 'Glow',
      brandKnowledge: knowledge,
      clientPack: true,
    });
    const paths = entries.map((e) => e.path);
    expect(paths).toContain('images/01_Hero.png');
    expect(paths).not.toContain('images/original/01_Hero.png');
    expect(paths).not.toContain('images/1x1/01_Hero.png');
    expect(paths).not.toContain('images/4x5/01_Hero.png');
    expect(paths).not.toContain('images/9x16/01_Hero.png');
    expect(paths.filter((p) => p.startsWith('images/'))).toHaveLength(1);
    expect(paths).toContain('rights-notes.txt');
    expect(paths).toContain('brand-report.md');
    expect(paths).toContain('captions.txt');
    expect(rights).toMatch(/Adapt format/i);
  });

  it('prefers caption pack over social draft for export copy', () => {
    const assets: StudioAsset[] = [
      {
        id: 'a1',
        name: 'Hero Shot',
        description: '',
        base64: 'aaa',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'generated',
        createdAt: new Date().toISOString(),
      },
    ];

    const text = buildExportCaptionsText({
      assets,
      brandName: 'Kageha',
      socialPostDraft: {
        id: 'd1',
        platform: 'instagram_feed',
        objective: 'awareness',
        heroAssetId: 'a1',
        supportingAssetIds: [],
        aspectRatio: '4:5',
        layout: { templateId: 't1', safeZones: [] },
        typography: {},
        copy: {
          headline: 'Old headline',
          caption: 'Old caption',
          hashtags: ['old'],
        },
        generationBrief: 'brief',
      },
      captionPack: {
        caption: 'Fresh caption from the final image.',
        hashtags: ['matcha', 'kageha'],
        altText: 'Matcha tin on marble',
        researchSummary: 'Used brand context plus image.',
        generatedAt: '2026-07-12T00:00:00.000Z',
        usedWebResearch: false,
        sourceAssetId: 'a1',
      },
    });

    expect(text).toContain('Fresh caption from the final image.');
    expect(text).toContain('#matcha');
    expect(text).toContain('Matcha tin on marble');
    expect(text).not.toContain('Old caption');
  });

  it('exports carousel caption pack as the winning post copy', () => {
    const assets: StudioAsset[] = [
      {
        id: 'v1',
        name: 'Slide 1',
        description: '',
        base64: 'aaa',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'generated',
        createdAt: new Date().toISOString(),
        carouselSetId: 'set-carousel',
        carouselSlideIndex: 1,
        carouselSlideTitle: 'Hook',
      },
      {
        id: 'v2',
        name: 'Slide 2',
        description: '',
        base64: 'bbb',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'generated',
        createdAt: new Date().toISOString(),
        carouselSetId: 'set-carousel',
        carouselSlideIndex: 2,
        carouselSlideTitle: 'Payoff',
      },
    ];

    const text = buildExportCaptionsText({
      assets,
      brandName: 'Kageha',
      socialPostDraft: {
        id: 'd1',
        platform: 'instagram_feed',
        objective: 'awareness',
        heroAssetId: 'v1',
        supportingAssetIds: ['v2'],
        aspectRatio: '4:5',
        layout: { templateId: 't1', safeZones: [] },
        typography: {},
        copy: {
          headline: 'Draft headline',
          caption: 'Per-slide draft caption that should lose.',
          hashtags: ['draft'],
        },
        generationBrief: 'brief',
      },
      captionPack: {
        caption: 'One caption for the whole carousel.',
        hashtags: ['matcha', 'carousel'],
        altText: 'Opening slide',
        researchSummary: 'Grounded on active slide in 2-slide set.',
        generatedAt: '2026-07-12T00:00:00.000Z',
        usedWebResearch: false,
        sourceAssetId: 'v2',
        slideCount: 2,
      },
    });

    expect(text).toContain('Carousel: 2-slide set');
    expect(text).toContain('One caption for the whole carousel.');
    expect(text).toContain('Slide: 1 (set-caro) — Hook');
    expect(text).toContain('Slide: 2 (set-caro) — Payoff');
    expect(text).not.toContain('Variation:');
    expect(text).not.toContain('Per-slide draft caption that should lose.');
  });

  it('labels true batch outputs as variations', () => {
    const text = buildExportCaptionsText({
      assets: [{
        id: 'v1',
        name: 'Generated · V1',
        description: '',
        base64: 'aaa',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'generated',
        createdAt: new Date().toISOString(),
        variationSetId: 'variation-set',
        variationIndex: 1,
      }],
    });

    expect(text).toContain('Variation: 1 (variatio)');
    expect(text).not.toContain('Slide:');
  });
});
