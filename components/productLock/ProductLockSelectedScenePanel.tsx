import React from 'react';
import { assetLabModeToSceneRoute, resolveSceneIdeaRoute } from '../../services/sceneRouter';
import type { PlannedStoryboardScene, ProductContext } from '../../types/brand';
import { getSceneRouteLabel } from './productLockViewUtils';

interface SceneAssetRequirement {
  title: string;
  detail: string;
}

interface Props {
  selectedScene: PlannedStoryboardScene | null;
  selectedSceneRequirement: SceneAssetRequirement | null;
  productUniverseProducts: ProductContext[];
  getAssetNumberLabel: (assetId?: string) => string | null;
  onAssignSceneProduct: (ideaId: string, productId: string) => void;
  onUpdateSceneIdea: (ideaId: string, updates: Partial<Pick<PlannedStoryboardScene, 'text' | 'visualDescription' | 'imagePrompt'>>) => void;
  onUseSceneIdeaForAssetLab: (idea: PlannedStoryboardScene) => void;
}

const ProductLockSelectedScenePanel: React.FC<Props> = ({
  selectedScene,
  selectedSceneRequirement,
  productUniverseProducts,
  getAssetNumberLabel,
  onAssignSceneProduct,
  onUpdateSceneIdea,
  onUseSceneIdeaForAssetLab,
}) => {
  const currentRoute = selectedScene ? resolveSceneIdeaRoute(selectedScene) : undefined;
  const suggestedRoute = selectedScene?.agencySuggestedRoute
    || (selectedScene?.agencySuggestedMode ? assetLabModeToSceneRoute(selectedScene.agencySuggestedMode) : undefined);
  const visualTaskLabel = selectedScene?.visualTask
    ? selectedScene.visualTask === 'use_imported'
      ? 'Use Imported'
      : selectedScene.visualTask === 'edit_imported'
        ? 'Edit Imported'
        : selectedScene.visualTask === 'overlay_on_product'
          ? 'Overlay / Composite'
          : 'Generate New'
    : null;

  return (
    <div className="rounded-xl border border-dark-border bg-dark-card p-4 space-y-4">
      <div>
        <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">Selected Scene</p>
        {selectedScene ? (
          <>
            <h5 className="text-lg font-semibold text-white">{selectedScene.text}</h5>
            <p className="mt-2 text-sm text-gray-400">{selectedScene.visualDescription}</p>
            {visualTaskLabel && (
              <div className="mt-3 flex flex-col gap-2 rounded-lg border border-white/10 bg-black/20 p-3">
                <div className="flex items-center justify-between gap-3">
                  <p className="text-[10px] uppercase tracking-wider text-gray-500">Visual Task</p>
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                    selectedScene.visualTask === 'use_imported'
                      ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20'
                      : selectedScene.visualTask === 'edit_imported'
                        ? 'bg-indigo-500/10 text-indigo-200 border-indigo-500/20'
                        : selectedScene.visualTask === 'overlay_on_product'
                          ? 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/20'
                          : 'bg-amber-500/10 text-amber-200 border-amber-500/20'
                  }`}
                  >
                    {visualTaskLabel}
                  </span>
                </div>
                {selectedScene.visualTaskReason && (
                  <p className="text-[12px] text-gray-300">{selectedScene.visualTaskReason}</p>
                )}
              </div>
            )}
          </>
        ) : (
          <div className="rounded-xl border border-dashed border-dark-border bg-black/10 p-6 text-center text-gray-400">
            <span className="block text-2xl mb-2 opacity-50">👆</span>
            <p className="text-white font-medium">No Scene Selected</p>
            <p className="text-sm mt-1">Select a scene from the left to edit it or assign an asset</p>
          </div>
        )}
      </div>

      {selectedScene && selectedSceneRequirement && (
        <div className="rounded-xl border border-white/10 bg-black/20 p-4">
          <p className="text-[10px] uppercase tracking-wider text-cyan-300">{selectedSceneRequirement.title}</p>
          <p className="mt-1 text-sm text-gray-300">{selectedSceneRequirement.detail}</p>
          <div className="mt-3 space-y-2 text-[12px] text-gray-400">
            <p>Prompt: {selectedScene.imagePrompt}</p>
            <p>Base asset: {selectedScene.baseAssetDescription ? `${getAssetNumberLabel(selectedScene.baseAssetId) || 'Imported asset'} · ${selectedScene.baseAssetDescription}` : 'None selected'}</p>
            <p>Generated asset: {selectedScene.linkedAssetDescription ? `${getAssetNumberLabel(selectedScene.selectedVariantAssetId) || 'Generated variant'} · ${selectedScene.linkedAssetDescription}` : 'None selected'}</p>
          </div>
        </div>
      )}

      {selectedScene && (
        <div className="rounded-xl border border-dark-border bg-dark-bg p-4 space-y-3">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Edit selected scene</p>
          {productUniverseProducts.length > 1 && (
            <div className="space-y-1">
              <label className="text-[11px] uppercase tracking-wider text-gray-500">Scene Product</label>
              <select
                value={selectedScene.productId || ''}
                onChange={(e) => onAssignSceneProduct(selectedScene.id, e.target.value)}
                className="w-full rounded-lg border border-dark-border bg-black/30 px-3 py-2 text-sm text-white outline-none"
              >
                <option value="">Choose product</option>
                {productUniverseProducts.map((product) => (
                  <option key={product.productId} value={product.productId}>{product.productTitle}</option>
                ))}
              </select>
            </div>
          )}
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-gray-500">Scene Text</label>
            <textarea
              value={selectedScene.text}
              onChange={(e) => onUpdateSceneIdea(selectedScene.id, { text: e.target.value })}
              placeholder="e.g. The camera pans across the product..."
              className="w-full min-h-[70px] rounded-lg border border-dark-border bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-gray-500">Visual Description</label>
            <textarea
              value={selectedScene.visualDescription}
              onChange={(e) => onUpdateSceneIdea(selectedScene.id, { visualDescription: e.target.value })}
              placeholder="e.g. Cinematic lighting, soft shadows"
              className="w-full min-h-[80px] rounded-lg border border-dark-border bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
          </div>
          <div className="space-y-1">
            <label className="text-[11px] uppercase tracking-wider text-gray-500">Image Generation Prompt</label>
            <textarea
              value={selectedScene.imagePrompt}
              onChange={(e) => onUpdateSceneIdea(selectedScene.id, { imagePrompt: e.target.value })}
              placeholder="e.g. high quality photorealistic image, 8k..."
              className="w-full min-h-[100px] rounded-lg border border-dark-border bg-black/30 px-3 py-2 text-sm text-white outline-none"
            />
          </div>
        </div>
      )}

      {selectedScene?.agencySuggestedPrompt && (
        <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4">
          <p className="text-[10px] uppercase tracking-wider text-fuchsia-200">Agency Recommendation</p>
          <p className="mt-2 text-sm text-white">{selectedScene.agencySuggestedReasoning || 'Agency mode prepared an asset plan for this scene.'}</p>
          <div className="mt-3 space-y-2 text-[12px] text-gray-200">
            <p>Current route: {getSceneRouteLabel(currentRoute)}</p>
            <p>Recommended base: {selectedScene.agencySuggestedBaseAssetDescription ? `${getAssetNumberLabel(selectedScene.agencySuggestedBaseAssetId) || 'Imported asset'} · ${selectedScene.agencySuggestedBaseAssetDescription}` : 'No specific base selected'}</p>
            <p>Recommended route: {getSceneRouteLabel(suggestedRoute)}</p>
            <p>Suggested prompt: {selectedScene.agencySuggestedPrompt}</p>
          </div>
          <button
            onClick={() => onUseSceneIdeaForAssetLab(selectedScene)}
            className="mt-3 px-3 py-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/15 text-[11px] font-semibold text-fuchsia-100"
          >
            Use Agency Prompt
          </button>
        </div>
      )}

      <div className="rounded-xl border border-dark-border bg-dark-bg p-4 space-y-3">
        <p className="text-[11px] uppercase tracking-wider text-gray-500">Recommended next step</p>
        <p className="text-sm text-gray-300">
          {selectedScene?.baseAssetId
            ? 'Generate a scene-specific asset from the selected base image if this scene needs a new angle.'
            : 'Select an imported base image below, then bind it to this scene or generate a new variant from it.'}
        </p>
      </div>
    </div>
  );
};

export default ProductLockSelectedScenePanel;
