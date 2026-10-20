import { describe, expect, it } from 'vitest';
import {
  formatReferenceStructureBlock,
  referenceStructurePlannerRules,
  type ReferenceStructureAnalysis,
} from '../services/referenceStructureAnalysis';
import {
  isInstagramReelUrl,
  isLikelyReferencePostUrl,
  normalizeInstagramReferenceUrl,
  screenshotsToCreativeUploads,
} from '../services/referencePostCapture';

describe('reference structure formatter', () => {
  const sample: ReferenceStructureAnalysis = {
    overallVibe: 'Bright UGC energy',
    doNotCopy: ['competitor logos', 'verbatim claims'],
    sourceLabel: '3 reference frame(s)',
    beats: [
      {
        index: 0,
        roleHint: 'hook',
        composition: 'Tight product fill, left-third',
        motionOrPacing: 'Snap zoom in',
        onScreenTextIntent: 'Curiosity line',
        durationHintSec: 2,
      },
      {
        index: 1,
        roleHint: 'ritual',
        composition: 'Hands preparing product',
        motionOrPacing: 'Slow push',
        onScreenTextIntent: 'Benefit hint',
      },
    ],
  };

  it('formats a brief block the planner can consume', () => {
    const block = formatReferenceStructureBlock(sample);
    expect(block).toContain('## REFERENCE STRUCTURE');
    expect(block).toContain('### Beat 1');
    expect(block).toContain('### Beat 2');
    expect(block).toContain('Bright UGC energy');
    expect(block).toContain('competitor logos');
    expect(block.match(/### Beat \d+/g)?.length).toBe(2);
  });

  it('exposes structure recreate planner rules', () => {
    expect(referenceStructurePlannerRules()).toMatch(/REFERENCE STRUCTURE RECREATE/i);
  });
});

describe('reference post URL mapping', () => {
  it('detects reel vs post URLs', () => {
    expect(isInstagramReelUrl('https://www.instagram.com/reel/ABC123/')).toBe(true);
    expect(isInstagramReelUrl('https://www.instagram.com/p/ABC123/')).toBe(false);
    expect(isLikelyReferencePostUrl('https://www.instagram.com/p/x/')).toBe(true);
    expect(isLikelyReferencePostUrl('not-a-url')).toBe(false);
  });

  it('normalizes /reels/ to /reel/ for embed capture', () => {
    expect(normalizeInstagramReferenceUrl('https://www.instagram.com/reels/Da8OPi6saHl/'))
      .toBe('https://www.instagram.com/reel/Da8OPi6saHl/');
    expect(normalizeInstagramReferenceUrl('https://www.instagram.com/reel/Da8OPi6saHl/'))
      .toBe('https://www.instagram.com/reel/Da8OPi6saHl/');
  });

  it('maps screenshots to CreativeReferenceUpload with structure notes', () => {
    const uploads = screenshotsToCreativeUploads({
      url: 'https://www.instagram.com/reel/xyz/',
      count: 2,
      kind: 'video',
      screenshots: [
        { base64: 'aaa', mimeType: 'image/jpeg', slideNumber: 1, label: 'reel_frame_1' },
        { base64: 'bbb', mimeType: 'image/jpeg', slideNumber: 2, label: 'reel_frame_2' },
      ],
    });
    expect(uploads).toHaveLength(2);
    expect(uploads[0].name).toMatch(/Reel frame|reel_frame/i);
    expect(uploads[0].note).toMatch(/Reference structure beat 1/i);
    expect(uploads[0].note).toMatch(/do not copy other brand/i);
    expect(uploads[0].previewUrl).toMatch(/^data:image\/jpeg;base64,/);
    expect(uploads[1].id).toContain('_2');
  });

  it('labels carousel slides for /p/ posts', () => {
    const uploads = screenshotsToCreativeUploads({
      url: 'https://www.instagram.com/p/abc/',
      count: 1,
      kind: 'carousel',
      screenshots: [
        { base64: 'ccc', mimeType: 'image/png', slideNumber: 1 },
      ],
    });
    expect(uploads[0].name).toMatch(/IG slide/i);
    expect(uploads[0].note).toMatch(/IG slide/i);
  });
});
