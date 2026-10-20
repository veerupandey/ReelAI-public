import { describe, expect, it } from 'vitest';
import { parseStudioEnhanceIntent } from '../../components/AIImageStudio/enhanceIntentService';

describe('parseStudioEnhanceIntent', () => {
  it('detects recreate / remake intent', () => {
    const result = parseStudioEnhanceIntent({
      prompt: 'Recreate this reference carousel for my product',
      creativeRoute: 'generate_fresh',
    });
    expect(result.intent).toBe('recreate_reference');
    expect(result.directives.length).toBeGreaterThan(0);
  });

  it('detects carousel slides', () => {
    const result = parseStudioEnhanceIntent({
      prompt: 'Slide 2 tip about matcha whisk ritual',
      creativeRoute: 'generate_fresh',
    });
    expect(result.intent).toBe('carousel_slide');
  });

  it('honors edit route over prompt keywords', () => {
    const result = parseStudioEnhanceIntent({
      prompt: 'Make it more lifestyle',
      creativeRoute: 'ai_upgrade',
    });
    expect(result.intent).toBe('edit_existing');
  });

  it('honors social_post output intent', () => {
    const result = parseStudioEnhanceIntent({
      prompt: 'Hero still',
      creativeRoute: 'generate_fresh',
      outputIntent: 'social_post',
    });
    expect(result.intent).toBe('social_post');
  });

  it('detects product hero from packshot language', () => {
    const result = parseStudioEnhanceIntent({
      prompt: 'Premium packshot on soft studio backdrop',
      creativeRoute: 'generate_fresh',
      referenceRoles: ['product'],
    });
    expect(result.intent).toBe('product_hero');
  });
});
