import { describe, expect, it } from 'vitest';
import { normalizeSongSegments } from '../services/geminiService';

describe('normalizeSongSegments', () => {
  it('pads undersized analysis to exact target count', () => {
    const result = normalizeSongSegments(
      [
        { startTime: 0, endTime: 4, description: 'Intro', visualPrompt: 'Wide shot' },
        { startTime: 4, endTime: 8, description: 'Drop', visualPrompt: 'Close-up' },
      ],
      12,
      4
    );

    expect(result).toHaveLength(4);
    expect(result[0].startTime).toBe(0);
    expect(result[3].endTime).toBe(12);
    expect(result.every((segment) => segment.visualPrompt.length > 0)).toBe(true);
  });

  it('truncates oversized analysis and covers full duration', () => {
    const input = Array.from({ length: 8 }, (_, index) => ({
      startTime: index,
      endTime: index + 1,
      description: `S${index}`,
      visualPrompt: `Prompt ${index}`,
    }));

    const result = normalizeSongSegments(input, 12, 3);
    expect(result).toHaveLength(3);
    expect(result[0].startTime).toBe(0);
    expect(result[2].endTime).toBe(12);
    expect(result.map((segment) => segment.description)).toEqual(['S0', 'S1', 'S2']);
  });

  it('builds fallback segments when input is empty', () => {
    const result = normalizeSongSegments([], 10, 5);
    expect(result).toHaveLength(5);
    expect(result[0].startTime).toBe(0);
    expect(result[4].endTime).toBe(10);
  });
});
