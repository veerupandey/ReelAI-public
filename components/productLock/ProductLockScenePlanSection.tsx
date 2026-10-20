import React, { useState } from 'react';
import ProductLockSceneCard from './ProductLockSceneCard';
import ProductLockSelectedScenePanel from './ProductLockSelectedScenePanel';
import type { LockedAssetJobState } from './productLockTypes';
import type { PlannedStoryboardScene, ProductContext, SceneRoute } from '../../types/brand';

interface Props {
  lockedProductTitle?: string;
  sceneIdeas: PlannedStoryboardScene[];
  visibleLockedAssets: Array<{ id: string; description?: string }>;
  selectedScene: PlannedStoryboardScene | null;
  selectedSceneRequirement: { title: string; detail: string } | null;
  productUniverseProducts: ProductContext[];
  lockedAssetJobs: Record<string, LockedAssetJobState>;
  sceneReorderPrompt: string;
  setSceneReorderPrompt: (value: string) => void;
  onSuggestSceneOrder: () => void;
  isReorderingScenes: boolean;
  onApplySuggestedSceneOrder: () => void;
  sceneReorderReasoning: string;
  getSceneStatusLabel: (idea: PlannedStoryboardScene) => string;
  getSceneAssetRequirement: (idea: PlannedStoryboardScene) => { title: string; detail: string };
  getAssetNumberLabel: (assetId?: string) => string | null;
  onUseSceneIdeaForAssetLab: (idea: PlannedStoryboardScene) => void;
  onAssignSceneProduct: (ideaId: string, productId: string) => void;
  onApproveSceneIdea: (ideaId: string) => void;
  onMoveSceneIdea: (ideaId: string, direction: 'up' | 'down') => void;
  onQuickGenerateSceneAsset: (ideaId: string) => void;
  onCancelSceneAssetJob: (ideaId: string) => void;
  onRemoveSceneIdea: (ideaId: string) => void;
  onUpdateSceneIdea: (ideaId: string, updates: Partial<Pick<PlannedStoryboardScene, 'text' | 'visualDescription' | 'imagePrompt'>>) => void;
  onUpdateSceneRoute: (ideaId: string, route: SceneRoute) => void;
  onAssignSceneBaseAsset: (ideaId: string, assetId: string) => void;
}

const ProductLockScenePlanSection: React.FC<Props> = ({
  lockedProductTitle,
  sceneIdeas,
  visibleLockedAssets,
  selectedScene,
  selectedSceneRequirement,
  productUniverseProducts,
  lockedAssetJobs,
  sceneReorderPrompt,
  setSceneReorderPrompt,
  onSuggestSceneOrder,
  isReorderingScenes,
  onApplySuggestedSceneOrder,
  sceneReorderReasoning,
  getSceneStatusLabel,
  getSceneAssetRequirement,
  getAssetNumberLabel,
  onUseSceneIdeaForAssetLab,
  onAssignSceneProduct,
  onApproveSceneIdea,
  onMoveSceneIdea,
  onQuickGenerateSceneAsset,
  onCancelSceneAssetJob,
  onRemoveSceneIdea,
  onUpdateSceneIdea,
  onUpdateSceneRoute,
  onAssignSceneBaseAsset,
}) => {
  const [isReorderOpen, setIsReorderOpen] = useState(false);

  if (sceneIdeas.length === 0) return null;

  return (
    <div className="rounded-2xl border border-dark-border bg-dark-bg p-5 space-y-4">
      <div className="flex items-center justify-between gap-4">
        <div>
          <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">2. Scene Plan</p>
          <h4 className="text-base font-semibold text-white">Review the auto-created storyboard</h4>
          <p className="text-sm text-gray-400 mt-1">
            These scenes came from the imported product page and your brief. Reorder, approve, or expand them only if needed.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <p className="text-xs text-gray-400">
            {sceneIdeas.filter((idea) => idea.approved).length}/{sceneIdeas.length} approved
          </p>
          <button
            onClick={() => setIsReorderOpen(!isReorderOpen)}
            className="px-3 py-1.5 rounded-lg border border-dark-border bg-black/20 text-[11px] font-medium text-gray-300 hover:text-white transition-colors"
          >
            {isReorderOpen ? 'Close AI Reorder' : 'AI Reorder'}
          </button>
        </div>
      </div>
      
      {isReorderOpen && (
        <div className="rounded-xl border border-white/5 bg-black/20 p-4 space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center gap-3">
            <input
              value={sceneReorderPrompt}
              onChange={(e) => setSceneReorderPrompt(e.target.value)}
              placeholder="Optional AI reorder prompt e.g. reorder to target acne-prone skin"
              className="flex-1 rounded-lg border border-dark-border bg-black/40 px-3 py-2 text-[11px] text-white outline-none focus:border-cyan-500/50 focus:ring-1 focus:ring-cyan-500/50"
            />
            <button
              onClick={onSuggestSceneOrder}
              disabled={isReorderingScenes || sceneIdeas.length <= 1}
              className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-4 py-2 text-[11px] font-semibold text-cyan-200 disabled:opacity-50 whitespace-nowrap"
            >
              {isReorderingScenes ? 'Reordering...' : 'Run AI Reorder'}
            </button>
          </div>
          {sceneReorderReasoning && (
            <div className="rounded-lg border border-cyan-500/20 bg-cyan-500/5 px-4 py-3 flex flex-col sm:flex-row items-baseline sm:items-center justify-between gap-4">
              <div>
                <p className="text-[10px] uppercase tracking-wider text-cyan-300">AI reorder reasoning</p>
                <p className="mt-1 text-sm text-cyan-100/90">{sceneReorderReasoning}</p>
              </div>
              <button
                onClick={onApplySuggestedSceneOrder}
                className="shrink-0 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-1.5 text-[11px] font-semibold text-emerald-200"
              >
                Apply Suggested Order
              </button>
            </div>
          )}
        </div>
      )}
      <div className="grid grid-cols-1 xl:grid-cols-[1.15fr_0.85fr] gap-5">
        <div className="space-y-3">
          {sceneIdeas.map((idea, index) => {
            const requirement = getSceneAssetRequirement(idea);
            const isSelected = selectedScene?.id === idea.id;
            return (
              <ProductLockSceneCard
                key={`status_${idea.id}`}
                idea={idea}
                index={index}
                totalScenes={sceneIdeas.length}
                isSelected={isSelected}
                statusLabel={getSceneStatusLabel(idea)}
                requirementTitle={requirement.title}
                requirementDetail={requirement.detail}
                currentSourceLabel={getAssetNumberLabel(idea.selectedVariantAssetId || idea.baseAssetId) || 'None selected'}
                assetOptions={visibleLockedAssets.map((asset, assetIndex) => ({
                  id: asset.id,
                  label: `Asset ${assetIndex + 1}: ${(asset.description || lockedProductTitle || 'Imported asset').slice(0, 60)}`,
                }))}
                isGenerating={Boolean(lockedAssetJobs[idea.id]?.isGenerating)}
                onSelect={() => onUseSceneIdeaForAssetLab(idea)}
                onApprove={() => onApproveSceneIdea(idea.id)}
                onMoveUp={() => onMoveSceneIdea(idea.id, 'up')}
                onMoveDown={() => onMoveSceneIdea(idea.id, 'down')}
                onQuickGenerate={() => onQuickGenerateSceneAsset(idea.id)}
                onCancel={() => onCancelSceneAssetJob(idea.id)}
                onDelete={() => onRemoveSceneIdea(idea.id)}
                onUpdateImagePrompt={(value) => onUpdateSceneIdea(idea.id, { imagePrompt: value })}
                onUpdateRoute={(value) => onUpdateSceneRoute(idea.id, value)}
                onAssignBaseAsset={(assetId) => onAssignSceneBaseAsset(idea.id, assetId)}
              />
            );
          })}
        </div>

        <ProductLockSelectedScenePanel
          selectedScene={selectedScene}
          selectedSceneRequirement={selectedSceneRequirement}
          productUniverseProducts={productUniverseProducts}
          getAssetNumberLabel={getAssetNumberLabel}
          onAssignSceneProduct={onAssignSceneProduct}
          onUpdateSceneIdea={onUpdateSceneIdea}
          onUseSceneIdeaForAssetLab={onUseSceneIdeaForAssetLab}
        />
      </div>
    </div>
  );
};

export default ProductLockScenePlanSection;
