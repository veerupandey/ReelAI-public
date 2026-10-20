import { describe, expect, it } from 'vitest';
import {
  getAspectRatioCompositionGuidance,
  makeCustomAspectId,
  nearestGeminiAspect,
  parsePixelAspectId,
  resolveAspectRatioOption,
  toGeminiImageAspectRatio,
} from '../../components/AIImageStudio/aspectRatioCatalog';

describe('aspectRatioCatalog', () => {
  it('maps Amazon A+ desktop to 21:9 gemini frame', () => {
    expect(toGeminiImageAspectRatio('1464x600')).toBe('21:9');
    expect(resolveAspectRatioOption('1464x600').targetWidth).toBe(1464);
    expect(resolveAspectRatioOption('1464x600').targetHeight).toBe(600);
  });

  it('maps Amazon A+ mobile to 4:3 gemini frame', () => {
    expect(toGeminiImageAspectRatio('600x450')).toBe('4:3');
    expect(getAspectRatioCompositionGuidance('600x450')).toMatch(/Amazon A\+ mobile/i);
  });

  it('supports custom pixel canvases', () => {
    const id = makeCustomAspectId(1200, 628);
    expect(id).toBe('1200x628');
    expect(parsePixelAspectId(id)).toEqual({ width: 1200, height: 628 });
    expect(nearestGeminiAspect(1200, 628)).toBe('16:9');
    expect(toGeminiImageAspectRatio(id)).toBe('16:9');
  });
});
