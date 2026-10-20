import React, { useState } from 'react';
import type { BrandAsset, PlannedStoryboardScene, ProductContext } from '../../types/brand';
import type { LockedAssetJobState } from './productLockTypes';

interface Props {
  lockedProduct: ProductContext;
  productUniverseProducts: ProductContext[];
  activeProductId: string;
  sceneIdeas: PlannedStoryboardScene[];
  visibleLockedAssets: BrandAsset[];
  excludedAssetIds: string[];
  selectedContinuationAssetId: string;
  selectedSceneJob?: LockedAssetJobState;
  setSelectedContinuationAssetId: (value: string) => void;
  onSmartEditLockedAsset: (assetIndex: number) => void;
  onToggleAssetExcluded: (assetId: string) => void;
  onSelectProduct: (productId: string) => void;
  onBack: () => void;
  toAssetPreviewUrl: (asset?: BrandAsset) => string | undefined;
}

const ProductLockAssetGridPanel: React.FC<Props> = ({
  lockedProduct,
  productUniverseProducts,
  activeProductId,
  sceneIdeas,
  visibleLockedAssets,
  excludedAssetIds,
  selectedContinuationAssetId,
  selectedSceneJob,
  setSelectedContinuationAssetId,
  onSmartEditLockedAsset,
  onToggleAssetExcluded,
  onSelectProduct,
  onBack,
  toAssetPreviewUrl,
}) => {
  const [isCompact, setIsCompact] = useState(false);
  const [expandedDescs, setExpandedDescs] = useState<Record<string, boolean>>({});

  const toggleDesc = (id: string) => setExpandedDescs(prev => ({ ...prev, [id]: !prev[id] }));

  const verdictTone = (asset: BrandAsset): string => {
    switch (asset.verdict) {
      case 'use_as_is':
        return 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20';
      case 'can_upgrade':
        return 'bg-cyan-500/10 text-cyan-200 border-cyan-500/20';
      case 'good_reference':
        return 'bg-amber-500/10 text-amber-200 border-amber-500/20';
      case 'do_not_use':
        return 'bg-red-500/10 text-red-200 border-red-500/20';
      default:
        return 'bg-white/5 text-gray-300 border-white/10';
    }
  };

  const verdictLabel = (asset: BrandAsset): string | null => {
    switch (asset.verdict) {
      case 'use_as_is':
        return 'Use';
      case 'can_upgrade':
        return 'Upgrade';
      case 'good_reference':
        return 'Reference';
      case 'do_not_use':
        return 'Skip';
      default:
        return null;
    }
  };

  return (
    <>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">1. Product Imported</p>
          <h3 className="text-xl font-bold text-white">{lockedProduct.productTitle}</h3>
          <p className="text-sm text-gray-400 mt-1">{lockedProduct.productUrl}</p>
          {productUniverseProducts.length > 1 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {productUniverseProducts.map((product) => (
                <button
                  key={product.productId}
                  onClick={() => onSelectProduct(product.productId)}
                  className={`rounded-full border px-3 py-1 text-[10px] font-semibold transition-colors ${
                    activeProductId === product.productId
                      ? 'border-cyan-500/30 bg-cyan-500/15 text-cyan-100'
                      : 'border-dark-border bg-white/5 text-gray-300 hover:text-white'
                  }`}
                >
                  {product.productTitle}
                </button>
              ))}
            </div>
          )}
          <p className="text-sm text-cyan-300 mt-3">
            {visibleLockedAssets.length} active image{visibleLockedAssets.length === 1 ? '' : 's'} ready as the base for every scene
          </p>
        </div>
        <button
          onClick={onBack}
          className="text-sm text-gray-400 hover:text-white transition-colors"
        >
          Change
        </button>
      </div>
      <div className="flex items-end justify-between">
        <label className="flex items-center gap-2 text-xs text-gray-400 cursor-pointer">
          <input type="checkbox" checked={isCompact} onChange={(e) => setIsCompact(e.target.checked)} className="rounded border-gray-600 bg-dark-bg text-cyan-500 focus:ring-cyan-500/50" />
          Compact View
        </label>
      </div>

      <div className={`grid gap-3 ${isCompact ? 'grid-cols-3 sm:grid-cols-4 xl:grid-cols-6' : 'grid-cols-2 sm:grid-cols-3 xl:grid-cols-4'}`}>
        {lockedProduct.productAssets.map((asset, index) => {
          const previewUrl = toAssetPreviewUrl(asset);
          const linkedScenes = sceneIdeas.filter((idea) => idea.baseAssetId === asset.id || idea.selectedVariantAssetId === asset.id);
          const isSelectedBase = selectedContinuationAssetId === asset.id;
          const isExcluded = excludedAssetIds.includes(asset.id);
          const visibleAssetIndex = visibleLockedAssets.findIndex((entry) => entry.id === asset.id);
          const isEditingForSelectedScene = selectedSceneJob?.isGenerating && selectedSceneJob.assetIndex === visibleAssetIndex;
          return (
            <div key={asset.id} className={`rounded-xl border p-2 ${isExcluded ? 'border-red-500/30 bg-red-500/5 opacity-60' : isSelectedBase ? 'border-cyan-400 bg-cyan-500/5' : 'border-dark-border bg-dark-bg'}`}>
              <div className="aspect-square rounded-lg overflow-hidden bg-black/30">
                {previewUrl ? (
                  <img src={previewUrl} className="w-full h-full object-cover" />
                ) : (
                  <div className="w-full h-full flex items-center justify-center text-2xl">🧴</div>
                )}
              </div>
              <div className="mt-2 flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-wider text-cyan-300">Asset {index + 1}</p>
                {linkedScenes.length > 0 && (
                  <span className="rounded-full bg-white/5 px-2 py-1 text-[10px] text-gray-300">
                    Used by {linkedScenes.length} scene{linkedScenes.length === 1 ? '' : 's'}
                  </span>
                )}
              </div>
              {(asset.verdict || asset.shotType) && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {verdictLabel(asset) && (
                    <span className={`rounded-full border px-2 py-0.5 text-[10px] font-semibold ${verdictTone(asset)}`}>
                      {verdictLabel(asset)}
                    </span>
                  )}
                  {asset.shotType && asset.shotType !== 'unknown' && (
                    <span className="rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-[10px] text-gray-300">
                      {asset.shotType.replace(/_/g, ' ')}
                    </span>
                  )}
                </div>
              )}
              <div className="mt-2 text-[11px] text-gray-300">
                <p className={expandedDescs[asset.id] ? '' : 'line-clamp-2'}>
                  {asset.semanticDescription || asset.description || 'No description'}
                </p>
                {(asset.semanticDescription || asset.description) && (asset.semanticDescription || asset.description || '').length > 70 && (
                  <button onClick={() => toggleDesc(asset.id)} className="text-cyan-400/80 hover:text-cyan-300 mt-0.5 text-[9px] uppercase tracking-wider font-semibold">
                    {expandedDescs[asset.id] ? 'Show less' : 'Show more'}
                  </button>
                )}
              </div>
              {asset.verdictReason && (
                <p className="mt-2 text-[10px] text-gray-500 line-clamp-2">
                  {asset.verdictReason}
                </p>
              )}
              {linkedScenes.length > 0 && (
                <p className="mt-2 text-[10px] text-gray-500 line-clamp-2">
                  {linkedScenes.map((idea) => `Scene ${sceneIdeas.findIndex((entry) => entry.id === idea.id) + 1}`).join(', ')}
                </p>
              )}
              <div className="mt-3 gap-2 flex">
                <button
                  onClick={() => setSelectedContinuationAssetId(asset.id)}
                  disabled={isExcluded}
                  className={`flex-1 px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${isSelectedBase ? 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30' : 'bg-white/5 text-white border-dark-border'}`}
                >
                  {isExcluded ? 'Excluded' : isSelectedBase ? 'Selected Base' : 'Select Base'}
                </button>
                <div className="flex-1 relative group/aiedit flex">
                  <button
                    onClick={() => onSmartEditLockedAsset(visibleAssetIndex)}
                    disabled={isExcluded || visibleAssetIndex < 0}
                    className="w-full px-2 py-1.5 rounded-lg bg-purple-500/10 text-purple-200 text-[11px] font-semibold border border-purple-500/20 disabled:opacity-50"
                  >
                    {isEditingForSelectedScene ? 'Editing...' : 'AI Edit'}
                  </button>
                  {isExcluded && (
                    <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-32 p-1.5 rounded bg-black text-[10px] text-gray-300 border border-dark-border text-center opacity-0 invisible group-hover/aiedit:opacity-100 group-hover/aiedit:visible transition-all z-10 pointer-events-none">
                      Restore this asset first to use AI Edit
                    </div>
                  )}
                </div>
              </div>
              <button
                onClick={() => onToggleAssetExcluded(asset.id)}
                className={`mt-2 w-full px-2 py-1.5 rounded-lg text-[11px] font-semibold border ${isExcluded ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20' : 'bg-red-500/10 text-red-200 border-red-500/20'}`}
              >
                {isExcluded ? 'Restore Asset' : 'Exclude Asset'}
              </button>
            </div>
          );
        })}
      </div>
    </>
  );
};

export default ProductLockAssetGridPanel;
