/**
 * Variation-set brand scorecard — roll up per-asset compliance for a set.
 */

import type { BrandComplianceCheck, StudioAsset } from './types';

export interface VariationSetScorecard {
  variationSetId: string;
  assetCount: number;
  scoredCount: number;
  pendingCount: number;
  averageScore: number | null;
  bestAssetId: string | null;
  worstAssetId: string | null;
  recommendedWinnerId: string | null;
  failCount: number;
  warningCount: number;
  passCount: number;
  categoryAverages: Array<{ category: BrandComplianceCheck['category']; average: number }>;
}

export function groupAssetsByVariationSet(
  assets: StudioAsset[],
): Map<string, StudioAsset[]> {
  const groups = new Map<string, StudioAsset[]>();
  for (const asset of assets) {
    if (!asset.variationSetId || asset.variationIndex == null || asset.carouselSetId) continue;
    const list = groups.get(asset.variationSetId) ?? [];
    list.push(asset);
    groups.set(asset.variationSetId, list);
  }
  for (const [, list] of groups) {
    list.sort((a, b) => (a.variationIndex ?? 0) - (b.variationIndex ?? 0));
  }
  return groups;
}

export function buildVariationSetScorecard(
  assets: StudioAsset[],
  variationSetId: string,
): VariationSetScorecard | null {
  const setAssets = assets.filter(
    (asset) =>
      asset.variationSetId === variationSetId &&
      asset.variationIndex != null &&
      !asset.carouselSetId,
  );
  if (setAssets.length === 0) return null;

  const scored = setAssets.filter((a) => a.brandCompliance);
  const pendingCount = setAssets.filter((a) => a.brandCompliancePending).length;
  const scores = scored.map((a) => a.brandCompliance!.score);
  const averageScore =
    scores.length > 0
      ? Math.round(scores.reduce((sum, s) => sum + s, 0) / scores.length)
      : null;

  let bestAssetId: string | null = null;
  let worstAssetId: string | null = null;
  let bestScore = -1;
  let worstScore = 101;
  for (const asset of scored) {
    const score = asset.brandCompliance!.score;
    if (score > bestScore) {
      bestScore = score;
      bestAssetId = asset.id;
    }
    if (score < worstScore) {
      worstScore = score;
      worstAssetId = asset.id;
    }
  }

  const favorites = scored.filter((a) => a.isFavorite);
  const recommendedPool = favorites.length > 0 ? favorites : scored;
  let recommendedWinnerId: string | null = null;
  let recommendedScore = -1;
  for (const asset of recommendedPool) {
    const score = asset.brandCompliance!.score;
    if (score > recommendedScore) {
      recommendedScore = score;
      recommendedWinnerId = asset.id;
    }
  }

  const categoryTotals = new Map<
    BrandComplianceCheck['category'],
    { sum: number; count: number }
  >();
  for (const asset of scored) {
    for (const check of asset.brandCompliance!.checks) {
      const prev = categoryTotals.get(check.category) ?? { sum: 0, count: 0 };
      categoryTotals.set(check.category, {
        sum: prev.sum + check.score,
        count: prev.count + 1,
      });
    }
  }

  return {
    variationSetId,
    assetCount: setAssets.length,
    scoredCount: scored.length,
    pendingCount,
    averageScore,
    bestAssetId,
    worstAssetId,
    recommendedWinnerId,
    failCount: scored.filter((a) => a.brandCompliance!.status === 'fail').length,
    warningCount: scored.filter((a) => a.brandCompliance!.status === 'warning').length,
    passCount: scored.filter((a) => a.brandCompliance!.status === 'pass').length,
    categoryAverages: Array.from(categoryTotals.entries()).map(([category, { sum, count }]) => ({
      category,
      average: Math.round(sum / count),
    })),
  };
}
