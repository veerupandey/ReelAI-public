import { describe, expect, it } from 'vitest';
import {
  VARIATION_AXES,
  buildBatchVariationDirective,
} from '../../components/AIImageStudio/variationDirections';

describe('buildBatchVariationDirective', () => {
  it('returns empty for a single image', () => {
    expect(buildBatchVariationDirective(0, 1)).toBe('');
  });

  it('assigns a distinct primary axis per index in a batch', () => {
    const directives = [0, 1, 2, 3].map((i) => buildBatchVariationDirective(i, 4));
    expect(directives.every((d) => d.includes('VARIATION BRIEF'))).toBe(true);
    expect(directives.every((d) => d.includes('MANDATORY CHANGE'))).toBe(true);

    const labels = directives.map((d) => {
      const match = d.match(/axis: ([^)]+)\)/);
      return match?.[1];
    });
    expect(new Set(labels).size).toBe(4);
    expect(labels[0]).toBe(VARIATION_AXES[0].label);
    expect(labels[1]).toBe(VARIATION_AXES[1].label);
  });

  it('adds a secondary axis after the first full cycle', () => {
    const firstCycle = buildBatchVariationDirective(0, 8);
    const secondCycle = buildBatchVariationDirective(VARIATION_AXES.length, 8);
    expect(firstCycle).not.toContain('SECONDARY CHANGE');
    expect(secondCycle).toContain('SECONDARY CHANGE');
  });

  it('requires divergence from reference framing', () => {
    const directive = buildBatchVariationDirective(0, 3);
    expect(directive).toMatch(/DO NOT copy the product reference/i);
    expect(directive).toMatch(/obviously different/i);
  });
});
