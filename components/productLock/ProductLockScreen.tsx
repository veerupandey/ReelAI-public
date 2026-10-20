import React, { useEffect, useState } from 'react';
import type { Brand, BrandAsset, ExecutionMode, PlannedStoryboardScene, ProductContext, ProductResolutionCandidate, SceneRoute } from '../../types/brand';
import ActiveJobsPanel from '../ActiveJobsPanel';
import ProductLockAssetGridPanel from './ProductLockAssetGridPanel';
import ProductLockAssetLabPanel from './ProductLockAssetLabPanel';
import ProductLockCandidateSelectionPanel from './ProductLockCandidateSelectionPanel';
import ProductLockFooter from './ProductLockFooter';
import ProductLockSceneExpansionPanel from './ProductLockSceneExpansionPanel';
import ProductLockScenePlanSection from './ProductLockScenePlanSection';
import type { LockedAssetJobState, ProductLockUndoAction, AgencySuggestedTrim, PlannerRequirement } from './productLockTypes';
import {
  capitalizeProductCandidateSource,
  getProductLockSceneAssetRequirement,
  getProductLockSceneStatusLabel,
  normalizeProductLockUrlForKey,
  toProductLockAssetPreviewUrl,
} from './productLockViewUtils';

interface Props {
  brand: Brand | null;
  lockedProduct: ProductContext | null;
  excludedAssetIds: string[];
  candidates: ProductResolutionCandidate[];
  errorMessage: string | null;
  lockedAssetPrompt: string;
  setLockedAssetPrompt: (value: string) => void;
  isGeneratingLockedAsset: boolean;
  isSuggestingLockedAssetPrompt: boolean;
  lockedAssetActionIndex: number | null;
  lockedAssetJobs: Record<string, LockedAssetJobState>;
  onGenerateLockedAsset: (assetIndex?: number, promptOverride?: string) => void;
  onSuggestLockedAssetPrompt: () => void;
  onSmartEditLockedAsset: (assetIndex: number) => void;
  selectedContinuationAssetId: string;
  setSelectedContinuationAssetId: (value: string) => void;
  selectedSceneIdeaId: string;
  productUniverseProducts: ProductContext[];
  activeProductId: string;
  onSelectProduct: (productId: string) => void;
  assetLabRoute: SceneRoute;
  setAssetLabRoute: (value: SceneRoute) => void;
  onUseSceneIdeaForAssetLab: (idea: PlannedStoryboardScene) => void;
  onAssignSceneProduct: (ideaId: string, productId: string) => void;
  onApproveSceneIdea: (ideaId: string) => void;
  onUpdateSceneIdea: (ideaId: string, updates: Partial<Pick<PlannedStoryboardScene, 'text' | 'visualDescription' | 'imagePrompt'>>) => void;
  onUpdateSceneRoute: (ideaId: string, route: SceneRoute) => void;
  onBindSceneIdeaToSelectedAsset: (ideaId: string) => void;
  onAssignSceneBaseAsset: (ideaId: string, assetId: string) => void;
  onSelectSceneVariant: (ideaId: string, assetId: string) => void;
  onUseSceneVariantAsBase: (ideaId: string, assetId: string) => void;
  onRejectSceneVariant: (ideaId: string, assetId: string) => void;
  sceneReorderPrompt: string;
  setSceneReorderPrompt: (value: string) => void;
  sceneIdeaPrompt: string;
  setSceneIdeaPrompt: (value: string) => void;
  sceneIdeas: PlannedStoryboardScene[];
  executionMode: ExecutionMode;
  agencySuggestedScenes: PlannedStoryboardScene[];
  isRunningAgencyAutopilot: boolean;
  onRunAgencyAutopilot: () => void;
  onAcceptAgencySuggestedScene: (ideaId: string) => void;
  plannerWarnings: PlannerRequirement[];
  onFixRequirement: (type: 'hook' | 'proof' | 'closing' | 'approval' | 'unbound' | 'repetitive') => void;
  sceneReadiness: { isReady: boolean; message: string };
  isAddingSceneIdea: boolean;
  agencySuggestedTrims: AgencySuggestedTrim[];
  onApplyAgencyTrim: (sceneId: string) => void;
  onAddSceneIdea: (useAI: boolean) => void;
  onRemoveSceneIdea: (ideaId: string) => void;
  onMoveSceneIdea: (ideaId: string, direction: 'up' | 'down') => void;
  onApplySuggestedSceneOrder: () => void;
  onSuggestSceneOrder: () => void;
  isReorderingScenes: boolean;
  onToggleAssetExcluded: (assetId: string) => void;
  sceneReorderReasoning: string;
  lastProductLockUndoAction: ProductLockUndoAction | null;
  onUndoLastProductLockAction: () => void;
  onQuickGenerateSceneAsset: (ideaId: string) => void;
  onCancelSceneAssetJob: (ideaId: string) => void;
  onChooseCandidate: (candidate: ProductResolutionCandidate) => void;
  onConfirm: () => void;
  onBack: () => void;
  narrativeArc?: string;
  creativeRationale?: string;
}

const ProductLockScreen: React.FC<Props> = ({
  brand,
  lockedProduct,
  excludedAssetIds,
  candidates,
  errorMessage,
  lockedAssetPrompt,
  setLockedAssetPrompt,
  isGeneratingLockedAsset,
  isSuggestingLockedAssetPrompt,
  lockedAssetActionIndex,
  lockedAssetJobs,
  onGenerateLockedAsset,
  onSuggestLockedAssetPrompt,
  onSmartEditLockedAsset,
  selectedContinuationAssetId,
  setSelectedContinuationAssetId,
  selectedSceneIdeaId,
  productUniverseProducts,
  activeProductId,
  onSelectProduct,
  assetLabRoute,
  setAssetLabRoute,
  onUseSceneIdeaForAssetLab,
  onAssignSceneProduct,
  onApproveSceneIdea,
  onUpdateSceneIdea,
  onUpdateSceneRoute,
  onBindSceneIdeaToSelectedAsset,
  onAssignSceneBaseAsset,
  onSelectSceneVariant,
  onUseSceneVariantAsBase,
  onRejectSceneVariant,
  sceneReorderPrompt,
  setSceneReorderPrompt,
  sceneIdeaPrompt,
  setSceneIdeaPrompt,
  sceneIdeas,
  executionMode,
  agencySuggestedScenes,
  isRunningAgencyAutopilot,
  onRunAgencyAutopilot,
  onAcceptAgencySuggestedScene,
  plannerWarnings,
  sceneReadiness,
  isAddingSceneIdea,
  agencySuggestedTrims,
  onApplyAgencyTrim,
  onAddSceneIdea,
  onRemoveSceneIdea,
  onMoveSceneIdea,
  onApplySuggestedSceneOrder,
  onSuggestSceneOrder,
  isReorderingScenes,
  onToggleAssetExcluded,
  sceneReorderReasoning,
  lastProductLockUndoAction,
  onUndoLastProductLockAction,
  onQuickGenerateSceneAsset,
  onCancelSceneAssetJob,
  onFixRequirement,
  onChooseCandidate,
  onConfirm,
  onBack,
  narrativeArc,
  creativeRationale,
}) => {
  const renderCandidatePreview = (candidate: ProductResolutionCandidate) => {
    const previewAsset = brand?.assets.find((asset) => normalizeProductLockUrlForKey(asset.originPageUrl) === normalizeProductLockUrlForKey(candidate.productUrl));
    const previewUrl = toProductLockAssetPreviewUrl(previewAsset);
    return (
      <div
        key={candidate.productId}
        className="rounded-2xl border border-dark-border bg-dark-card p-4 flex items-center gap-4"
      >
        <div className="w-16 h-16 rounded-xl bg-dark-bg border border-dark-border overflow-hidden shrink-0">
          {previewUrl ? (
            <img src={previewUrl} className="w-full h-full object-cover" />
          ) : (
            <div className="w-full h-full flex items-center justify-center text-2xl">🧴</div>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="text-white font-semibold">{candidate.productTitle}</p>
          <p className="text-xs text-gray-400 truncate">{candidate.productUrl}</p>
          <p className="text-[11px] text-purple-300 mt-1">
            {capitalizeProductCandidateSource(candidate.source)} · confidence {Math.round(candidate.confidence)}
          </p>
        </div>
        <button
          onClick={() => onChooseCandidate(candidate)}
          className="px-4 py-2 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-semibold"
        >
          Choose
        </button>
      </div>
    );
  };

  const getAssetNumberLabel = (assetId?: string) => {
    if (!assetId || !lockedProduct) return null;
    for (const product of productUniverseProducts.length > 0 ? productUniverseProducts : [lockedProduct]) {
      const assetIndex = product.productAssets.findIndex((asset) => asset.id === assetId);
      if (assetIndex >= 0) {
        return productUniverseProducts.length > 1
          ? `${product.productTitle} · Asset ${assetIndex + 1}`
          : `Asset ${assetIndex + 1}`;
      }
    }
    return null;
  };

  const visibleLockedAssets = lockedProduct?.productAssets.filter((asset) => !excludedAssetIds.includes(asset.id)) || [];
  const selectedScene = sceneIdeas.find((idea) => idea.id === selectedSceneIdeaId) || sceneIdeas[0] || null;
  const selectedSceneRequirement = selectedScene
    ? getProductLockSceneAssetRequirement(selectedScene, lockedProduct, getAssetNumberLabel)
    : null;
  const selectedSceneJob = selectedScene ? lockedAssetJobs[selectedScene.id] : undefined;
  const activeGenerationJobs = sceneIdeas
    .filter((idea) => lockedAssetJobs[idea.id]?.isGenerating)
    .map((idea) => ({
      idea,
      job: lockedAssetJobs[idea.id],
    }));

  const [showUndo, setShowUndo] = useState(false);
  useEffect(() => {
    if (lastProductLockUndoAction) {
      setShowUndo(true);
      const t = setTimeout(() => setShowUndo(false), 8000);
      return () => clearTimeout(t);
    } else {
      setShowUndo(false);
    }
  }, [lastProductLockUndoAction]);

  const isSceneAssetSatisfied = (idea: PlannedStoryboardScene): boolean => {
    if (idea.selectedVariantAssetId) return true;
    if (idea.visualTask === 'generate_new') return true;
    if (idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product') return false;
    return Boolean(idea.baseAssetId);
  };

  const isStep1Done = Boolean(lockedProduct);
  const isStep2Done = isStep1Done && sceneIdeas.length > 0 && sceneIdeas.every((idea) => idea.approved);
  const isStep3Done = isStep2Done && sceneIdeas.every(isSceneAssetSatisfied);
  const isStep4Done = isStep3Done && sceneReadiness.isReady;

  const getStepStatus = (n: number) => {
    if (n === 1) return isStep1Done ? 'complete' : 'active';
    if (n === 2) return isStep2Done ? 'complete' : isStep1Done ? 'active' : 'upcoming';
    if (n === 3) return isStep3Done ? 'complete' : isStep2Done ? 'active' : 'upcoming';
    if (n === 4) return isStep4Done ? 'complete' : isStep3Done ? 'active' : 'upcoming';
    return 'upcoming';
  };

  return (
    <div className="max-w-full space-y-6">
      {/* Top Header Section */}
      <div className="bg-dark-card rounded-2xl border border-dark-border p-6 shadow-2xl shadow-black/40">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.28em] text-cyan-300">Phase 3: Product & Storyboard Lock</p>
            <h2 className="mt-1 text-2xl font-bold text-white">Review your ad structure</h2>
            <p className="text-sm text-gray-400 mt-1">
              Verify imported assets, approve scenes, and generate extra variants if needed.
            </p>
          </div>
          <div className="flex items-center gap-3">
            {executionMode === 'agency' && isRunningAgencyAutopilot && (
              <div className="px-3 py-1.5 rounded-full bg-fuchsia-500/10 border border-fuchsia-500/20 text-[10px] text-fuchsia-300 font-bold flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-fuchsia-500 animate-pulse" />
                Agency Autopilot Running
              </div>
            )}
            <div className="flex items-center -space-x-2">
              {[1, 2, 3, 4].map(n => {
                const status = getStepStatus(n);
                return (
                  <div key={n} className={`w-8 h-8 rounded-full border-[3px] border-dark-card flex items-center justify-center text-[10px] font-bold transition-all shadow-sm ${
                    status === 'complete' ? 'bg-emerald-500 border-emerald-600 text-white z-10' : 
                    status === 'active' ? 'bg-gradient-to-br from-purple-500 to-fuchsia-600 border-fuchsia-400 text-white z-20 scale-110 shadow-fuchsia-500/30 shadow-lg' : 
                    'bg-gray-800 border-gray-700 text-gray-500'
                  }`}>
                    {status === 'complete' ? '✓' : n}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {executionMode === 'agency' && (creativeRationale || narrativeArc) && (
        <div className="relative overflow-hidden rounded-2xl border border-purple-500/30 bg-gradient-to-br from-purple-900/40 via-dark-card to-dark-card p-6 shadow-xl shadow-purple-500/5 group">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <span className="text-6xl">🎬</span>
          </div>
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-3">
               <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-500/20 text-purple-300 ring-1 ring-purple-500/30">
                 ✨
               </span>
               <h3 className="text-lg font-bold text-white tracking-tight">Director's Vision</h3>
            </div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {narrativeArc && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-purple-300 font-bold">Narrative Archetype</p>
                  <p className="text-sm text-gray-200 leading-relaxed font-medium">{narrativeArc}</p>
                </div>
              )}
              {creativeRationale && (
                <div className="space-y-1">
                  <p className="text-[10px] uppercase tracking-wider text-cyan-300 font-bold">Creative Rationale</p>
                  <p className="text-xs text-gray-400 leading-relaxed italic">"{creativeRationale}"</p>
                </div>
              )}
            </div>
          </div>
          <div className="absolute bottom-0 left-0 h-[2px] w-full bg-gradient-to-r from-transparent via-purple-500/50 to-transparent" />
        </div>
      )}

      {errorMessage && (
        <div className="rounded-2xl border border-red-500/30 bg-red-500/10 px-5 py-4 text-sm text-red-200">
          {errorMessage}
        </div>
      )}

      {showUndo && lastProductLockUndoAction && (
        <div className="rounded-2xl border border-cyan-500/20 bg-cyan-500/10 px-5 py-4 flex items-center justify-between gap-4 relative overflow-hidden">
          <div className="absolute bottom-0 left-0 h-1 bg-cyan-500 animate-[shrinkX_8s_linear_forwards]" style={{ width: '100%' }} />
          <p className="text-sm text-cyan-100 z-10">
            {lastProductLockUndoAction.type === 'remove_scene'
              ? 'Scene removed from the storyboard.'
              : 'Asset visibility changed for this campaign.'}
          </p>
          <div className="flex gap-2 z-10">
            <button
              onClick={() => {
                onUndoLastProductLockAction();
                setShowUndo(false);
              }}
              className="px-3 py-1.5 rounded-lg border border-cyan-400/30 bg-cyan-400/10 text-[11px] font-semibold text-cyan-100 transition-colors hover:bg-cyan-400/20"
            >
              Undo
            </button>
            <button
              onClick={() => setShowUndo(false)}
              className="px-3 py-1.5 text-[11px] text-cyan-200/50 hover:text-cyan-200"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

      {lockedProduct ? (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Column: Storyboard (7/12) */}
          <div className="lg:col-span-7 space-y-6">
            <ProductLockScenePlanSection
              lockedProductTitle={lockedProduct.productTitle}
              sceneIdeas={sceneIdeas}
              visibleLockedAssets={visibleLockedAssets}
              selectedScene={selectedScene}
              selectedSceneRequirement={selectedSceneRequirement}
              productUniverseProducts={productUniverseProducts}
              lockedAssetJobs={lockedAssetJobs}
              sceneReorderPrompt={sceneReorderPrompt}
              setSceneReorderPrompt={setSceneReorderPrompt}
              onSuggestSceneOrder={onSuggestSceneOrder}
              isReorderingScenes={isReorderingScenes}
              onApplySuggestedSceneOrder={onApplySuggestedSceneOrder}
              sceneReorderReasoning={sceneReorderReasoning}
              getSceneStatusLabel={getProductLockSceneStatusLabel}
              getSceneAssetRequirement={(idea) => getProductLockSceneAssetRequirement(idea, lockedProduct, getAssetNumberLabel)}
              getAssetNumberLabel={getAssetNumberLabel}
              onUseSceneIdeaForAssetLab={onUseSceneIdeaForAssetLab}
              onAssignSceneProduct={onAssignSceneProduct}
              onApproveSceneIdea={onApproveSceneIdea}
              onMoveSceneIdea={onMoveSceneIdea}
              onQuickGenerateSceneAsset={onQuickGenerateSceneAsset}
              onCancelSceneAssetJob={onCancelSceneAssetJob}
              onRemoveSceneIdea={onRemoveSceneIdea}
              onUpdateSceneIdea={onUpdateSceneIdea}
              onUpdateSceneRoute={onUpdateSceneRoute}
              onAssignSceneBaseAsset={onAssignSceneBaseAsset}
            />

            {sceneIdeas.length > 0 && (
              <ProductLockSceneExpansionPanel
                executionMode={executionMode}
                agencySuggestedScenes={agencySuggestedScenes}
                agencySuggestedTrims={agencySuggestedTrims}
                isRunningAgencyAutopilot={isRunningAgencyAutopilot}
                onRunAgencyAutopilot={onRunAgencyAutopilot}
                onAcceptAgencySuggestedScene={onAcceptAgencySuggestedScene}
                onApplyAgencyTrim={onApplyAgencyTrim}
                sceneIdeaPrompt={sceneIdeaPrompt}
                setSceneIdeaPrompt={setSceneIdeaPrompt}
                isAddingSceneIdea={isAddingSceneIdea}
                onAddSceneIdea={onAddSceneIdea}
                narrativeArc={narrativeArc}
                creativeRationale={creativeRationale}
              />
            )}
          </div>

          {/* Right Column: Assets & Labs (5/12) */}
          <div className="lg:col-span-5 space-y-6 lg:sticky lg:top-24 lg:max-h-[calc(100vh-120px)] lg:overflow-y-auto lg:pr-2 custom-scrollbar">
            <div className="bg-dark-card rounded-2xl border border-dark-border p-6 shadow-xl shadow-black/20">
              <ProductLockAssetGridPanel
                lockedProduct={lockedProduct}
                productUniverseProducts={productUniverseProducts}
                activeProductId={activeProductId}
                sceneIdeas={sceneIdeas}
                visibleLockedAssets={visibleLockedAssets}
                excludedAssetIds={excludedAssetIds}
                selectedContinuationAssetId={selectedContinuationAssetId}
                selectedSceneJob={selectedSceneJob}
                setSelectedContinuationAssetId={setSelectedContinuationAssetId}
                onSmartEditLockedAsset={onSmartEditLockedAsset}
                onToggleAssetExcluded={onToggleAssetExcluded}
                onSelectProduct={onSelectProduct}
                onBack={onBack}
                toAssetPreviewUrl={toProductLockAssetPreviewUrl}
              />
            </div>

            <ActiveJobsPanel
              jobs={activeGenerationJobs.map(({ idea, job }) => ({
                ideaId: idea.id,
                sceneNumber: sceneIdeas.findIndex((entry) => entry.id === idea.id) + 1,
                text: idea.text,
                assetIndex: job?.assetIndex ?? null,
              }))}
              onCancelSceneAssetJob={onCancelSceneAssetJob}
            />

            {plannerWarnings.length > 0 && (
              <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 p-5 space-y-3">
                <div>
                  <p className="text-[10px] uppercase tracking-wider text-amber-300 mb-1">Attention</p>
                  <h4 className="text-sm font-semibold text-white">Requirement Check</h4>
                </div>
                <div className="space-y-2">
                  {plannerWarnings.map((warning, idx) => (
                    <div key={`${warning.type}_${idx}`} className="flex items-center justify-between gap-4 p-2 rounded-xl bg-black/20 border border-amber-500/10">
                      <div className="flex items-start gap-2 flex-1">
                        <span className="mt-1 w-1 h-1 rounded-full bg-amber-500 shrink-0" />
                        <p className="text-xs text-amber-100">{warning.message}</p>
                      </div>
                      <button
                        onClick={() => onFixRequirement(warning.type)}
                        disabled={isAddingSceneIdea || isGeneratingLockedAsset}
                        className="shrink-0 px-2.5 py-1 rounded-lg bg-amber-500/20 border border-amber-500/30 text-[10px] font-bold text-amber-200 hover:bg-amber-500/30 transition-colors disabled:opacity-50"
                      >
                        {warning.type === 'approval' ? 'Approve All' : warning.type === 'unbound' ? 'Bind Assets' : 'Fix with AI'}
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}

            <ProductLockAssetLabPanel
              selectedScene={selectedScene}
              sceneIdeas={sceneIdeas}
              lockedProduct={lockedProduct}
              visibleLockedAssets={visibleLockedAssets}
              lockedAssetPrompt={lockedAssetPrompt}
              setLockedAssetPrompt={setLockedAssetPrompt}
              isGeneratingLockedAsset={isGeneratingLockedAsset}
              isSuggestingLockedAssetPrompt={isSuggestingLockedAssetPrompt}
              assetLabRoute={assetLabRoute}
              setAssetLabRoute={setAssetLabRoute}
              selectedContinuationAssetId={selectedContinuationAssetId}
              setSelectedContinuationAssetId={setSelectedContinuationAssetId}
              selectedSceneIdeaId={selectedSceneIdeaId}
              onSuggestLockedAssetPrompt={onSuggestLockedAssetPrompt}
              onUseSceneIdeaForAssetLab={onUseSceneIdeaForAssetLab}
              onGenerateLockedAsset={onGenerateLockedAsset}
              onBindSceneIdeaToSelectedAsset={onBindSceneIdeaToSelectedAsset}
            />

            <ProductLockFooter
              sceneReadiness={sceneReadiness}
              sceneCount={sceneIdeas.length}
              onBack={onBack}
              onConfirm={onConfirm}
            />
          </div>
        </div>
      ) : (
        <div className="max-w-4xl mx-auto">
          <ProductLockCandidateSelectionPanel
            candidates={candidates}
            renderCandidatePreview={renderCandidatePreview}
            onBack={onBack}
          />
        </div>
      )}
    </div>
  );
};

export default ProductLockScreen;
