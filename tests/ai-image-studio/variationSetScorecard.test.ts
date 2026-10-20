import { describe, expect, it } from 'vitest';
import {
  buildVariationSetScorecard,
  groupAssetsByVariationSet,
} from '../../components/AIImageStudio/variationSetScorecard';
import type { StudioAsset } from '../../components/AIImageStudio/types';

function asset(
  id: string,
  opts: Partial<StudioAsset> & {
    score?: number;
    status?: 'pass' | 'warning' | 'fail';
  } = {},
): StudioAsset {
  const { score, status, ...rest } = opts;
  return {
    id,
    name: id,
    description: '',
    base64: 'YWJj',
    mimeType: 'image/png',
    width: 1,
    height: 1,
    source: 'generated',
    createdAt: new Date().toISOString(),
    variationSetId: 'set-1',
    variationIndex: 1,
    ...(score != null
      ? {
          brandCompliance: {
            score,
            status: status || 'pass',
            summary: 'ok',
            checks: [
              {
                category: 'brand_colors',
                label: 'Color',
                status: status || 'pass',
                score,
                finding: 'ok',
              },
            ],
            evaluatedAt: new Date().toISOString(),
            evaluationMode: 'limited',
          },
        }
      : {}),
    ...rest,
  };
}

describe('variationSetScorecard', () => {
  it('groups assets by variation set', () => {
    const groups = groupAssetsByVariationSet([
      asset('a1', { variationIndex: 2, score: 80 }),
      asset('a2', { variationSetId: 'set-2', variationIndex: 1, score: 70 }),
      asset('a3', { variationIndex: 1, score: 90 }),
    ]);
    expect(groups.get('set-1')?.map((a) => a.id)).toEqual(['a3', 'a1']);
    expect(groups.get('set-2')?.map((a) => a.id)).toEqual(['a2']);
  });

  it('ignores carousel and incomplete variation metadata', () => {
    const groups = groupAssetsByVariationSet([
      asset('variation', { variationIndex: 1 }),
      asset('carousel', {
        variationIndex: 2,
        carouselSetId: 'carousel-1',
        carouselSlideIndex: 2,
      }),
      asset('legacy-incomplete', { variationIndex: undefined }),
    ]);

    expect(groups.get('set-1')?.map((a) => a.id)).toEqual(['variation']);
    expect(buildVariationSetScorecard(
      [asset('carousel', {
        variationIndex: 1,
        carouselSetId: 'carousel-1',
        carouselSlideIndex: 1,
      })],
      'set-1',
    )).toBeNull();
  });

  it('builds scorecard with favorite-preferred winner', () => {
    const card = buildVariationSetScorecard(
      [
        asset('a1', { score: 95, status: 'pass' }),
        asset('a2', { score: 70, status: 'warning', isFavorite: true }),
        asset('a3', { score: 40, status: 'fail' }),
      ],
      'set-1',
    );
    expect(card).not.toBeNull();
    expect(card!.averageScore).toBe(68);
    expect(card!.bestAssetId).toBe('a1');
    expect(card!.recommendedWinnerId).toBe('a2');
    expect(card!.failCount).toBe(1);
    expect(card!.categoryAverages[0].category).toBe('brand_colors');
  });
});
