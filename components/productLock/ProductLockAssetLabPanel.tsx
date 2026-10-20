import React from 'react';
import type { BrandAsset, PlannedStoryboardScene, ProductContext, SceneRoute } from '../../types/brand';
import { getSceneRouteLabel, getSceneRouteTone, toProductLockAssetPreviewUrl } from './productLockViewUtils';

interface Props {
  selectedScene: PlannedStoryboardScene | null;
  sceneIdeas: PlannedStoryboardScene[];
  lockedProduct: ProductContext;
  visibleLockedAssets: BrandAsset[];
  lockedAssetPrompt: string;
  setLockedAssetPrompt: (value: string) => void;
  isGeneratingLockedAsset: boolean;
  isSuggestingLockedAssetPrompt: boolean;
  assetLabRoute: SceneRoute;
  setAssetLabRoute: (value: SceneRoute) => void;
  selectedContinuationAssetId: string;
  setSelectedContinuationAssetId: (value: string) => void;
  selectedSceneIdeaId: string;
  onSuggestLockedAssetPrompt: () => void;
  onUseSceneIdeaForAssetLab: (idea: PlannedStoryboardScene) => void;
  onGenerateLockedAsset: (assetIndex?: number, promptOverride?: string) => void;
  onBindSceneIdeaToSelectedAsset: (ideaId: string) => void;
}

const ProductLockAssetLabPanel: React.FC<Props> = ({
  selectedScene,
  sceneIdeas,
  lockedProduct,
  visibleLockedAssets,
  lockedAssetPrompt,
  setLockedAssetPrompt,
  isGeneratingLockedAsset,
  isSuggestingLockedAssetPrompt,
  assetLabRoute,
  setAssetLabRoute,
  selectedContinuationAssetId,
  setSelectedContinuationAssetId,
  selectedSceneIdeaId,
  onSuggestLockedAssetPrompt,
  onUseSceneIdeaForAssetLab,
  onGenerateLockedAsset,
  onBindSceneIdeaToSelectedAsset,
}) => {
  return (
    <div className="rounded-2xl border border-dark-border bg-dark-bg p-5 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">4. Create Extra Assets</p>
        <h4 className="text-lg font-semibold text-white">Generate more scene images from the same product</h4>
        <p className="text-sm text-gray-400 mt-1">
          Use imported product shots as references. AI can create extra angles, variants, or scene-specific images while preserving the exact same product.
        </p>
      </div>
      <div className="rounded-xl border border-white/10 bg-black/20 p-4">
        <p className="text-[10px] uppercase tracking-wider text-cyan-300">Generating for</p>
        <p className="mt-1 text-sm text-white">
          {selectedScene ? `Scene ${sceneIdeas.findIndex((idea) => idea.id === selectedScene.id) + 1}: ${selectedScene.text}` : 'No scene selected yet'}
        </p>
        <p className="mt-1 text-[12px] text-gray-400">
          {selectedScene
            ? 'Pick a base asset below or keep the selected one, then generate a scene-specific image.'
            : 'Select a scene first so the generated asset has a clear destination.'}
        </p>
        {selectedScene && (
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              onClick={onSuggestLockedAssetPrompt}
              disabled={isSuggestingLockedAssetPrompt || isGeneratingLockedAsset}
              className="px-3 py-1.5 rounded-lg bg-cyan-500/10 border border-cyan-500/20 text-cyan-200 text-[11px] font-semibold disabled:opacity-50"
            >
              {isSuggestingLockedAssetPrompt ? 'Suggesting...' : 'AI Suggest Prompt'}
            </button>
            <p className="text-[11px] text-gray-500 self-center">
              AI writes the first draft. You can edit it before generating.
            </p>
            {selectedScene.agencySuggestedPrompt && (
              <button
                onClick={() => onUseSceneIdeaForAssetLab(selectedScene)}
                className="px-3 py-1.5 rounded-lg bg-fuchsia-500/10 border border-fuchsia-500/20 text-fuchsia-200 text-[11px] font-semibold"
              >
                Use Agency Recommendation
              </button>
            )}
          </div>
        )}
      </div>
      <div>
        <textarea
          value={lockedAssetPrompt}
          onChange={(e) => setLockedAssetPrompt(e.target.value)}
          placeholder="e.g. Premium marble vanity hero shot, bottle label fully visible, cinematic lighting, ingredient accents around the product"
          className="w-full min-h-[140px] rounded-xl border border-dark-border bg-black/30 px-4 py-3 text-sm text-white outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50 transition-all"
        />
        <p className="text-[11px] text-gray-500 mt-1.5 ml-1">
          {selectedSceneIdeaId
            ? `Providing prompt context for Scene ${sceneIdeas.findIndex((idea) => idea.id === selectedSceneIdeaId) + 1}`
            : 'No scene selected yet'}
        </p>
      </div>
      <div className="space-y-2 block">
        <span className="block text-xs uppercase tracking-wider text-gray-500">Creative Route</span>
        <div className="grid grid-cols-2 md:grid-cols-3 gap-2">
          {[
            { value: 'use_existing' as SceneRoute, label: getSceneRouteLabel('use_existing') },
            { value: 'upgrade_existing' as SceneRoute, label: getSceneRouteLabel('upgrade_existing') },
            { value: 'composite_product' as SceneRoute, label: getSceneRouteLabel('composite_product') },
            { value: 'generate_fresh' as SceneRoute, label: getSceneRouteLabel('generate_fresh') },
            { value: 'continue_sequence' as SceneRoute, label: getSceneRouteLabel('continue_sequence') },
          ].map((mode) => (
            <button
              key={mode.value}
              onClick={() => setAssetLabRoute(mode.value)}
              className={`px-3 py-2.5 rounded-xl text-[12px] font-medium border text-center transition-colors ${
                assetLabRoute === mode.value
                  ? getSceneRouteTone(mode.value)
                  : 'bg-black/30 text-gray-400 border-dark-border hover:bg-white/5 hover:text-white'
              }`}
            >
              {mode.label}
            </button>
          ))}
        </div>
      </div>
      <div className="space-y-2">
        <span className="block text-xs uppercase tracking-wider text-gray-500">Base Image Source</span>
        {visibleLockedAssets.length === 0 ? (
          <p className="text-sm text-gray-400">No locked assets available.</p>
        ) : (
          <div className="flex overflow-x-auto gap-3 pb-2 -mx-1 px-1 custom-scrollbar">
            {visibleLockedAssets.map((asset, index) => {
              const isSelected = selectedContinuationAssetId === asset.id || (!selectedContinuationAssetId && index === 0);
              const previewUrl = toProductLockAssetPreviewUrl(asset);
              return (
                <button
                  key={asset.id}
                  onClick={() => setSelectedContinuationAssetId(asset.id)}
                  className={`flex-shrink-0 w-24 rounded-lg overflow-hidden border-2 transition-all ${
                    isSelected ? 'border-cyan-400 opacity-100' : 'border-transparent opacity-60 hover:opacity-100'
                  }`}
                  title={asset.description || lockedProduct.productTitle}
                >
                  <div className="aspect-square bg-black/40">
                    {previewUrl ? (
                      <img src={previewUrl} className="w-full h-full object-cover" />
                    ) : (
                      <div className="w-full h-full flex items-center justify-center text-lg">🧴</div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => onGenerateLockedAsset()}
          disabled={isGeneratingLockedAsset || !(lockedAssetPrompt || '').trim() || !selectedScene}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-emerald-500 to-cyan-500 text-white font-semibold disabled:opacity-50"
        >
          {isGeneratingLockedAsset ? 'Generating...' : 'Generate Asset For Selected Scene'}
        </button>
        {selectedScene && (
          <button
            onClick={() => onBindSceneIdeaToSelectedAsset(selectedScene.id)}
            disabled={!selectedContinuationAssetId && !visibleLockedAssets[0]}
            className="px-4 py-2.5 rounded-xl bg-white/5 border border-dark-border text-white font-semibold flex items-center gap-2 group disabled:opacity-50"
          >
            Bind Asset to Scene (No Generate)
            <div className="relative group/tooltip flex items-center justify-center w-5 h-5 rounded-full bg-white/10 text-[11px] text-gray-400 group-hover:text-white transition-colors cursor-help">
              <span className="cursor-help">i</span>
              <div className="absolute bottom-full left-1/2 -translate-x-1/2 mb-2 w-48 p-2 rounded-lg bg-black text-xs text-gray-300 border border-dark-border text-center opacity-0 invisible group-hover/tooltip:opacity-100 group-hover/tooltip:visible transition-all z-10 pointer-events-none">
                Skips image generation and directly uses the selected base image for this scene.
              </div>
            </div>
          </button>
        )}
      </div>
    </div>
  );
};

export default ProductLockAssetLabPanel;
