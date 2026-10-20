import { describe, expect, it } from 'vitest';
import {
  continuityImpliesPerson,
  formatContinuityLockBlock,
  formatContinuityLockMarkdown,
  parsePlannerPayload,
  prependContinuityLock,
  synthesizeContinuityFromScenes,
} from '../services/sceneContinuity';

describe('parsePlannerPayload', () => {
  it('parses object form with continuity + scenes', () => {
    const raw = JSON.stringify({
      continuity: {
        cast: 'young woman, warm olive skin, dark bun',
        wardrobe: 'cream linen robe',
        locationFamily: 'sunlit kitchen',
        lightingPalette: 'soft morning window light',
        doNotChange: ['face', 'hair', 'product packaging'],
      },
      scenes: [
        { role: 'hook', voiceoverText: 'Wait for it.', imagePrompt: 'Macro tin', visualMode: 'product_locked' },
        { role: 'ritual', voiceoverText: 'Then whisk.', imagePrompt: 'Hands whisking', visualMode: 'product_composite' },
      ],
    });
    const parsed = parsePlannerPayload(raw);
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.continuity.cast).toMatch(/young woman/i);
    expect(parsed.continuity.doNotChange).toContain('face');
  });

  it('accepts legacy bare array and synthesizes continuity', () => {
    const raw = JSON.stringify([
      { role: 'hook', imagePrompt: 'Opening packshot', voiceoverText: 'Hey' },
      { role: 'cta', imagePrompt: 'Final CTA', voiceoverText: 'Shop' },
    ]);
    const parsed = parsePlannerPayload(raw);
    expect(parsed.scenes).toHaveLength(2);
    expect(parsed.continuity.cast).toBeTruthy();
    expect(parsed.continuity.locationFamily).toMatch(/Opening packshot|same world/i);
  });
});

describe('prependContinuityLock', () => {
  const bible = synthesizeContinuityFromScenes([
    { imagePrompt: 'Sunlit matcha ritual' },
  ]);

  it('prepends CONTINUITY LOCK and continues-from for scene 2+', () => {
    const out = prependContinuityLock('Hands pour matcha', bible, 1);
    expect(out).toMatch(/CONTINUITY LOCK/i);
    expect(out).toMatch(/^CONTINUITY LOCK[\s\S]*continues from previous shot:/i);
    expect(out).toContain('Hands pour matcha');
  });

  it('does not force continues-from on scene 0', () => {
    const out = prependContinuityLock('Hero packshot', bible, 0);
    expect(out).toMatch(/CONTINUITY LOCK/i);
    expect(out).not.toMatch(/continues from previous shot:/i);
  });

  it('does not double-prepend lock', () => {
    const once = prependContinuityLock('A', bible, 0);
    const twice = prependContinuityLock(once, bible, 0);
    expect(twice.match(/CONTINUITY LOCK/gi)?.length).toBe(1);
  });
});

describe('continuityImpliesPerson', () => {
  it('detects person cast vs product-only', () => {
    expect(continuityImpliesPerson({
      cast: 'young woman with dark hair',
      wardrobe: 'linen',
      locationFamily: 'kitchen',
      lightingPalette: 'daylight',
      doNotChange: [],
    })).toBe(true);
    expect(continuityImpliesPerson({
      cast: 'product-only packshot, no people',
      wardrobe: 'n/a',
      locationFamily: 'studio',
      lightingPalette: 'softbox',
      doNotChange: [],
    })).toBe(false);
  });
});

describe('formatContinuityLockMarkdown', () => {
  it('renders a console-friendly card', () => {
    const md = formatContinuityLockMarkdown({
      cast: 'creator POV hands only',
      wardrobe: 'n/a',
      locationFamily: 'bathroom sink',
      lightingPalette: 'cool daylight',
      doNotChange: ['product packaging'],
    });
    expect(md).toContain('## Continuity Lock');
    expect(md).toContain('creator POV');
    expect(formatContinuityLockBlock({
      cast: 'x', wardrobe: 'y', locationFamily: 'z', lightingPalette: 'w', doNotChange: ['a'],
    })).toContain('Do not change: a');
  });
});
