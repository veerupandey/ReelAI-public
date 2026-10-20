/**
 * productTruthOrchestration — shared import → Product Truth wiring for Image Studio.
 *
 * Two-phase flow:
 * 1. Synchronous preliminary truth so the UI can show Product Truth immediately
 * 2. Async visual analysis that upgrades facts/preservation rules in place
 */

import type { Dispatch } from 'react';
import type { StudioAction } from './useStudioReducer';
import type { ProductTruth, StudioAsset } from './types';
import {
  analyzeProductTruth,
  buildPreliminaryProductTruth,
  type ProductPageSignals,
} from './productTruthService';
import { getProductKnowledge } from '../../services/productPageImportService';

export function signalsFromProductUrl(url: string): ProductPageSignals | undefined {
  const knowledge = getProductKnowledge(url);
  if (!knowledge) return undefined;

  const claims = knowledge.facts.filter((f) =>
    /claim|clinically|dermatologist|free from|proven/i.test(f),
  );
  const benefits = knowledge.facts.filter((f) =>
    /benefit|barrier|sensitive|hydrat|sooth/i.test(f),
  );
  const ingredients = knowledge.facts.filter((f) => /ingredient/i.test(f));

  return {
    productName: knowledge.productTitle,
    description: knowledge.signalSummary || undefined,
    claims: claims.length > 0 ? claims : knowledge.facts.slice(0, 5),
    benefits,
    ingredients,
  };
}

/**
 * Merge existing protected assets with newly imported ones (deduped by id).
 */
export function mergeProductAssets(
  existing: StudioAsset[],
  incoming: StudioAsset[],
): StudioAsset[] {
  const byId = new Map<string, StudioAsset>();
  for (const asset of existing) byId.set(asset.id, asset);
  for (const asset of incoming) byId.set(asset.id, asset);
  return Array.from(byId.values());
}

/**
 * Establish or refresh Product Truth after an import.
 * Safe to call with empty assets (clears existing truth).
 */
export async function refreshProductTruth(
  dispatch: Dispatch<StudioAction>,
  productAssets: StudioAsset[],
  signals?: ProductPageSignals,
  existing?: ProductTruth | null,
): Promise<void> {
  if (productAssets.length === 0) {
    if (existing) dispatch({ type: 'CLEAR_PRODUCT_TRUTH' });
    return;
  }

  const preliminary = buildPreliminaryProductTruth(productAssets, signals);
  const seed: ProductTruth = existing
    ? {
        ...preliminary,
        id: existing.id,
        userCorrections: existing.userCorrections,
        protectedAssetIds: [
          ...new Set([...existing.protectedAssetIds, ...preliminary.protectedAssetIds]),
        ],
      }
    : preliminary;

  dispatch({ type: 'SET_PRODUCT_TRUTH', productTruth: seed });

  try {
    const assetsForAnalysis = productAssets.filter((a) =>
      seed.protectedAssetIds.includes(a.id),
    );
    const analyzed = await analyzeProductTruth({
      productAssets: assetsForAnalysis,
      signals,
    });
    dispatch({
      type: 'SET_PRODUCT_TRUTH',
      productTruth: {
        ...analyzed,
        id: seed.id,
        userCorrections: seed.userCorrections,
        protectedAssetIds: seed.protectedAssetIds,
      },
    });
  } catch {
    // Preliminary truth remains; panel already shows analysis-in-progress notes.
  }
}
