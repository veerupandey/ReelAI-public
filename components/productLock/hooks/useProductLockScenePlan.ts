import React, { useCallback, useState } from 'react';
import { generateSingleScenePlan, suggestSceneOrder } from '../../../services/geminiService';
import type { AssetLabMode, BrandAsset, CampaignPlatform, ProductContext, SceneRoute, StoryboardSceneState } from '../../../types/brand';
import type { ProductLockUndoAction, AgencySuggestedTrim, SceneOrderingFunction } from '../productLockTypes';
import { resolveSceneIdeaRoute, sceneRouteToAssetLabMode } from '../../../services/sceneRouter';

interface UseProductLockScenePlanParams {
  lockedProduct: ProductContext | null;
  availableProducts: ProductContext[];
  platform: CampaignPlatform;
  availableLockedAssets: BrandAsset[];
  selectedContinuationAssetId: string;
  setSelectedSceneIdeaId: React.Dispatch<React.SetStateAction<string>>;
  setActiveProductId: React.Dispatch<React.SetStateAction<string>>;
  setSelectedContinuationAssetId: React.Dispatch<React.SetStateAction<string>>;
  setLockedAssetPrompt: React.Dispatch<React.SetStateAction<string>>;
  setAssetLabMode: React.Dispatch<React.SetStateAction<AssetLabMode>>;
  setErrorMessage: React.Dispatch<React.SetStateAction<string | null>>;
  planSceneIdeaOrder?: SceneOrderingFunction;
}

const formatPlatformLabel = (platform: CampaignPlatform): string => {
  switch (platform) {
    case 'instagram_reels':
      return 'Instagram Reels';
    case 'youtube_shorts':
      return 'YouTube Shorts';
    case 'tiktok':
    default:
      return 'TikTok';
  }
};

const summarizeLockedAsset = (asset: BrandAsset, index: number): string => {
  const parts = [
    `Asset ${index + 1}: ${asset.semanticDescription || asset.description || 'Imported product image'}`,
  ];
  if (asset.verdict) {
    parts.push(`verdict=${asset.verdict}`);
  }
  if (asset.shotType && asset.shotType !== 'unknown') {
    parts.push(`shot=${asset.shotType}`);
  }
  if (asset.bestSceneRoles?.length) {
    parts.push(`bestRoles=${asset.bestSceneRoles.slice(0, 3).join(', ')}`);
  }
  return parts.join(' | ');
};

export const useProductLockScenePlan = ({
  lockedProduct,
  availableProducts,
  platform,
  availableLockedAssets,
  selectedContinuationAssetId,
  setSelectedSceneIdeaId,
  setActiveProductId,
  setSelectedContinuationAssetId,
  setLockedAssetPrompt,
  setAssetLabMode,
  setErrorMessage,
  planSceneIdeaOrder,
}: UseProductLockScenePlanParams) => {
  const [sceneIdeaPrompt, setSceneIdeaPrompt] = useState('');
  const [sceneIdeas, setSceneIdeas] = useState<StoryboardSceneState[]>([]);
  const [narrativeArc, setNarrativeArc] = useState('');
  const [creativeRationale, setCreativeRationale] = useState('');
  const [isAddingSceneIdea, setIsAddingSceneIdea] = useState(false);
  const [agencySuggestedScenes, setAgencySuggestedScenes] = useState<StoryboardSceneState[]>([]);
  const [agencySuggestedTrims, setAgencySuggestedTrims] = useState<AgencySuggestedTrim[]>([]);
  const [sceneReorderPrompt, setSceneReorderPrompt] = useState('');
  const [isReorderingScenes, setIsReorderingScenes] = useState(false);
  const [sceneReorderReasoning, setSceneReorderReasoning] = useState('');
  const [suggestedSceneOrderIds, setSuggestedSceneOrderIds] = useState<string[]>([]);
  const [excludedAssetIds, setExcludedAssetIds] = useState<string[]>([]);
  const [lastProductLockUndoAction, setLastProductLockUndoAction] = useState<ProductLockUndoAction | null>(null);

  const inferScenePlannerBucket = useCallback((idea: Pick<StoryboardSceneState, 'text' | 'visualDescription' | 'imagePrompt'>): number => {
    const text = `${idea.text} ${idea.visualDescription} ${idea.imagePrompt}`.toLowerCase();
    if (/(hook|scroll stop|opening|intro|pattern interrupt|first shot)/.test(text)) return 0;
    if (/(problem|pain|struggle|acne|issue|concern|before)/.test(text)) return 1;
    if (/(demo|apply|application|texture|ingredient|proof|benefit|result|after|comparison|routine)/.test(text)) return 2;
    if (/(cta|shop|buy|checkout|final shot|hero|packshot|closing)/.test(text)) return 4;
    return 3;
  }, []);

  const handleUpdateSceneIdea = useCallback((
    ideaId: string,
    updates: Partial<Pick<StoryboardSceneState, 'text' | 'visualDescription' | 'imagePrompt' | 'motionMode' | 'durationSec'>>,
  ) => {
    setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? {
      ...idea,
      ...updates,
      approved: false,
    } : idea));
  }, []);

  const handleUpdateSceneMotionMode = useCallback((
    ideaId: string,
    motionMode: import('../../../types/brand').SceneMotionMode,
  ) => {
    setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? {
      ...idea,
      motionMode,
      approved: false,
    } : idea));
  }, []);

  const handleUpdateSceneRoute = useCallback((ideaId: string, route: SceneRoute) => {
    const generationMode = sceneRouteToAssetLabMode(route);
    const sourceMode = route === 'use_existing'
      ? 'crop_reframe_asset'
      : route === 'generate_fresh'
        ? 'generate_fresh'
        : 'edit_from_asset';
    setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? {
      ...idea,
      approved: false,
      route,
      generationMode,
      sourceMode,
    } : idea));
    setAssetLabMode(generationMode);
  }, [setAssetLabMode]);

  const handleToggleAssetExcluded = useCallback((assetId: string) => {
    const previousExcludedAssetIds = excludedAssetIds;
    const previousSceneIdeas = sceneIdeas;
    const previousSelectedContinuationAssetId = selectedContinuationAssetId;
    setLastProductLockUndoAction({
      type: 'toggle_asset_excluded',
      assetId,
      excludedAssetIds: previousExcludedAssetIds,
      sceneIdeas: previousSceneIdeas,
      selectedContinuationAssetId: previousSelectedContinuationAssetId,
    });
    setExcludedAssetIds((prev) => prev.includes(assetId) ? prev.filter((id) => id !== assetId) : [...prev, assetId]);

    setSceneIdeas((prev) => prev.map((idea) => {
      const usesAsset = idea.baseAssetId === assetId || idea.selectedVariantAssetId === assetId;
      if (!usesAsset) return idea;
      return {
        ...idea,
        approved: false,
        baseAssetId: idea.baseAssetId === assetId ? undefined : idea.baseAssetId,
        baseAssetDescription: idea.baseAssetId === assetId ? undefined : idea.baseAssetDescription,
        selectedVariantAssetId: idea.selectedVariantAssetId === assetId ? undefined : idea.selectedVariantAssetId,
        linkedAssetId: idea.linkedAssetId === assetId ? undefined : idea.linkedAssetId,
        linkedAssetDescription: idea.linkedAssetId === assetId ? undefined : idea.linkedAssetDescription,
        variants: (idea.variants || []).filter((variant) => variant.assetId !== assetId),
      };
    }));

    setSelectedContinuationAssetId((prev) => prev === assetId ? '' : prev);
  }, [excludedAssetIds, sceneIdeas, selectedContinuationAssetId, setSelectedContinuationAssetId]);

  const handleSuggestSceneOrder = useCallback(async () => {
    if (sceneIdeas.length <= 1) return;

    setIsReorderingScenes(true);
    setErrorMessage(null);
    try {
      const orderedIds = await suggestSceneOrder({
        reorderPrompt: (sceneReorderPrompt || '').trim() || undefined,
        scenes: sceneIdeas.map((idea) => ({
          id: idea.id,
          text: idea.text,
          visualDescription: idea.visualDescription,
          imagePrompt: idea.imagePrompt,
        })),
      });

      setSuggestedSceneOrderIds(orderedIds.orderedSceneIds);
      setSceneReorderReasoning(orderedIds.reasoning);
    } catch (error: any) {
      console.error('[BrandVideoCreator] Scene reorder failed:', error);
      setErrorMessage(error.message || 'AI could not reorder the scenes.');
    } finally {
      setIsReorderingScenes(false);
    }
  }, [sceneIdeas, sceneReorderPrompt, setErrorMessage]);

  const handleAddSceneIdea = useCallback(async (useAI: boolean) => {
    if (!lockedProduct) return;
    const input = (sceneIdeaPrompt || '').trim();

    setIsAddingSceneIdea(true);
    setErrorMessage(null);
    try {
      if (!useAI) {
        // StoryboardScreen "Add Scene" has no prompt field — allow blank placeholders.
        const placeholder = input || `Scene ${sceneIdeas.length + 1}`;
        setSceneIdeas((prev) => [...prev, {
          id: `scene_idea_${Date.now().toString(36)}`,
          text: placeholder,
          visualDescription: input || 'Describe the visual for this scene',
          imagePrompt: input || '',
          approved: false,
          productId: lockedProduct.productId,
          productTitle: lockedProduct.productTitle,
          route: 'generate_fresh',
          sourceMode: 'generate_fresh',
          generationMode: 'new_from_scene',
          visualTask: 'generate_new',
        }]);
        setSceneIdeaPrompt('');
        return;
      }

      const extractedAssetScenes = availableLockedAssets.slice(0, 8).map((asset, index) => ({
        sceneNumber: index + 1,
        visualDescription: asset.semanticDescription || asset.description || `Extracted product asset ${index + 1}`,
        imagePrompt: `Use the retrieved product asset as reference. ${asset.semanticDescription || asset.description || lockedProduct.productTitle}`,
        estimatedDuration: 3,
        scriptGuidance: `Ground the scene in this retrieved product visual: ${asset.semanticDescription || asset.description || lockedProduct.productTitle}`,
      }));
      const manualIdeaScenes = sceneIdeas.map((idea, index) => ({
        sceneNumber: extractedAssetScenes.length + index + 1,
        visualDescription: idea.visualDescription,
        imagePrompt: idea.imagePrompt,
        estimatedDuration: 3,
        scriptGuidance: idea.text,
      }));
      const existingScenes = [...extractedAssetScenes, ...manualIdeaScenes];
      const assetSummary = availableLockedAssets
        .slice(0, 8)
        .map((asset, index) => summarizeLockedAsset(asset, index))
        .join('\n');
      const generatedScene = await generateSingleScenePlan(
        `${lockedProduct.productTitle} for ${formatPlatformLabel(platform)}\nRetrieved product assets:\n${assetSummary}`,
        existingScenes,
        `${input || 'Add one strong new scene that keeps the same locked product but introduces a fresh visual beat.'}\nUse the retrieved product assets as primary grounding context before inventing anything new.`,
      );
      setSceneIdeas((prev) => [...prev, {
        id: `scene_idea_${Date.now().toString(36)}`,
        text: generatedScene.scriptGuidance,
        visualDescription: generatedScene.visualDescription,
        imagePrompt: generatedScene.imagePrompt,
        approved: false,
        productId: lockedProduct.productId,
        productTitle: lockedProduct.productTitle,
        route: 'composite_product',
        sourceMode: 'generate_matching_shot',
        generationMode: 'continue_image_into_scene',
      }]);
      setSceneIdeaPrompt('');
    } catch (error: any) {
      console.error('[BrandVideoCreator] Scene idea generation failed:', error);
      setErrorMessage(error.message || 'Could not create a scene idea for the locked-product run.');
    } finally {
      setIsAddingSceneIdea(false);
    }
  }, [availableLockedAssets, lockedProduct, platform, sceneIdeaPrompt, sceneIdeas, setErrorMessage]);

  const handleRemoveSceneIdea = useCallback((ideaId: string) => {
    setSceneIdeas((prev) => {
      const index = prev.findIndex((idea) => idea.id === ideaId);
      if (index === -1) return prev;
      setLastProductLockUndoAction({
        type: 'remove_scene',
        idea: prev[index],
        index,
      });
      return prev.filter((idea) => idea.id !== ideaId);
    });
    setSelectedSceneIdeaId((prev) => prev === ideaId ? '' : prev);
  }, [setSelectedSceneIdeaId]);

  const handleUndoLastProductLockAction = useCallback(() => {
    if (!lastProductLockUndoAction) return;

    if (lastProductLockUndoAction.type === 'remove_scene') {
      setSceneIdeas((prev) => {
        const next = [...prev];
        next.splice(lastProductLockUndoAction.index, 0, lastProductLockUndoAction.idea);
        return next;
      });
      setSelectedSceneIdeaId(lastProductLockUndoAction.idea.id);
    }

    if (lastProductLockUndoAction.type === 'toggle_asset_excluded') {
      setExcludedAssetIds(lastProductLockUndoAction.excludedAssetIds);
      setSceneIdeas(lastProductLockUndoAction.sceneIdeas);
      setSelectedContinuationAssetId(lastProductLockUndoAction.selectedContinuationAssetId);
    }

    setLastProductLockUndoAction(null);
  }, [lastProductLockUndoAction, setSelectedContinuationAssetId, setSelectedSceneIdeaId]);

  const handleMoveSceneIdea = useCallback((ideaId: string, direction: 'up' | 'down') => {
    setSceneIdeas((prev) => {
      const index = prev.findIndex((idea) => idea.id === ideaId);
      if (index === -1) return prev;
      const targetIndex = direction === 'up' ? index - 1 : index + 1;
      if (targetIndex < 0 || targetIndex >= prev.length) return prev;

      const next = [...prev];
      const [idea] = next.splice(index, 1);
      next.splice(targetIndex, 0, idea);
      return next;
    });
  }, []);

  const handleApplySuggestedSceneOrder = useCallback(() => {
    if (suggestedSceneOrderIds.length > 0) {
      setSceneIdeas((prev) => {
        const byId = new Map(prev.map((idea) => [idea.id, idea]));
        const ordered = suggestedSceneOrderIds
          .map((id) => byId.get(id))
          .filter((idea): idea is StoryboardSceneState => Boolean(idea));
        const missing = prev.filter((idea) => !suggestedSceneOrderIds.includes(idea.id));
        return [...ordered, ...missing];
      });
      setSuggestedSceneOrderIds([]);
      setSceneReorderReasoning('');
      return;
    }

    if (!planSceneIdeaOrder) return;
    setSceneIdeas((prev) => planSceneIdeaOrder(prev).map(({ suggestedPosition: _suggestedPosition, ...idea }) => idea));
  }, [planSceneIdeaOrder, setSceneIdeas, suggestedSceneOrderIds]);

  const handleUseSceneIdeaForAssetLab = useCallback((idea: StoryboardSceneState) => {
    setSelectedSceneIdeaId(idea.id);
    setActiveProductId(idea.productId || lockedProduct?.productId || '');
    setLockedAssetPrompt(idea.agencySuggestedPrompt || idea.imagePrompt || idea.visualDescription || idea.text);
    const route = idea.agencySuggestedRoute || resolveSceneIdeaRoute(idea);
    setAssetLabMode(sceneRouteToAssetLabMode(route));
    if (idea.agencySuggestedBaseAssetId || idea.baseAssetId) {
      setSelectedContinuationAssetId(idea.agencySuggestedBaseAssetId || idea.baseAssetId || '');
    } else {
      setSelectedContinuationAssetId('');
    }
  }, [lockedProduct?.productId, setActiveProductId, setAssetLabMode, setLockedAssetPrompt, setSelectedContinuationAssetId, setSelectedSceneIdeaId]);

  const handleAcceptAgencySuggestedScene = useCallback((ideaId: string) => {
    const suggestion = agencySuggestedScenes.find((idea) => idea.id === ideaId);
    if (!suggestion) return;

    setSceneIdeas((prev) => {
      const next = [...prev];
      const suggestionBucket = inferScenePlannerBucket(suggestion);
      const insertionIndex = next.findIndex((idea) => inferScenePlannerBucket(idea) > suggestionBucket);
      const safeInsertionIndex = insertionIndex === -1 ? next.length : Math.max(0, insertionIndex);
      next.splice(safeInsertionIndex, 0, { ...suggestion, agencySuggested: false });
      return next;
    });
    setAgencySuggestedScenes((prev) => prev.filter((idea) => idea.id !== ideaId));
    setSelectedSceneIdeaId(suggestion.id);
    setActiveProductId(suggestion.productId || lockedProduct?.productId || '');
  }, [agencySuggestedScenes, inferScenePlannerBucket, lockedProduct?.productId, setActiveProductId, setSelectedSceneIdeaId]);

  const handleAssignSceneProduct = useCallback((ideaId: string, productId: string) => {
    const product = availableProducts.find((entry) => entry.productId === productId);
    if (!product) return;

    setSceneIdeas((prev) => prev.map((idea) => {
      if (idea.id !== ideaId) return idea;
      if (idea.productId === product.productId) {
        return {
          ...idea,
          productTitle: product.productTitle,
        };
      }
      return {
        ...idea,
        approved: false,
        productId: product.productId,
        productTitle: product.productTitle,
        baseAssetId: undefined,
        baseAssetDescription: undefined,
        selectedVariantAssetId: undefined,
        linkedAssetId: undefined,
        linkedAssetDescription: undefined,
        agencySuggestedBaseAssetId: undefined,
        agencySuggestedBaseAssetDescription: undefined,
        variants: [],
      };
    }));
    setSelectedSceneIdeaId(ideaId);
    setActiveProductId(product.productId);
    setSelectedContinuationAssetId('');
  }, [availableProducts, setActiveProductId, setSelectedContinuationAssetId, setSelectedSceneIdeaId]);

  const handleApproveSceneIdea = useCallback((ideaId: string) => {
    setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? { ...idea, approved: !idea.approved } : idea));
  }, []);

  const handleBindSceneIdeaToSelectedAsset = useCallback((ideaId: string) => {
    if (!lockedProduct) return;
    const asset = availableLockedAssets.find((entry) => entry.id === selectedContinuationAssetId) || availableLockedAssets[0];
    if (!asset) {
      setErrorMessage('Select or keep at least one locked product image before attaching it to a scene.');
      return;
    }

    setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? {
      ...idea,
      approved: false,
      productId: idea.productId || lockedProduct.productId,
      productTitle: idea.productTitle || lockedProduct.productTitle,
      route: 'use_existing',
      baseAssetId: asset.id,
      baseAssetDescription: asset.description,
      sourceMode: 'crop_reframe_asset',
      generationMode: sceneRouteToAssetLabMode('use_existing'),
      visualGap: false,
    } : idea));
    setAssetLabMode(sceneRouteToAssetLabMode('use_existing'));
  }, [availableLockedAssets, lockedProduct, selectedContinuationAssetId, setAssetLabMode, setErrorMessage]);

  const handleAssignSceneBaseAsset = useCallback((ideaId: string, assetId: string, directAsset?: BrandAsset) => {
    if (!assetId) {
      setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? {
        ...idea,
        approved: false,
        baseAssetId: undefined,
        baseAssetDescription: undefined,
        linkedAssetId: undefined,
        linkedAssetDescription: undefined,
      } : idea));
      return;
    }

    const asset = directAsset
      || availableLockedAssets.find((entry) => entry.id === assetId)
      || availableProducts.flatMap((product) => product.productAssets).find((entry) => entry.id === assetId);
    if (!asset) return;

    const ownerProduct = availableProducts.find((product) =>
      product.productAssets.some((entry) => entry.id === asset.id),
    );

    setSceneIdeas((prev) => prev.map((idea) => idea.id === ideaId ? {
      ...idea,
      approved: false,
      productId: idea.productId || ownerProduct?.productId || lockedProduct?.productId,
      productTitle: idea.productTitle || ownerProduct?.productTitle || lockedProduct?.productTitle,
      route: idea.route === 'generate_fresh' ? 'use_existing' : (idea.route || 'use_existing'),
      baseAssetId: asset.id,
      baseAssetDescription: asset.description,
      sourceMode: 'crop_reframe_asset',
      generationMode: sceneRouteToAssetLabMode(
        idea.route === 'generate_fresh' ? 'use_existing' : (idea.route || 'use_existing'),
      ),
      visualGap: false,
      visualTask: idea.visualTask === 'generate_new' ? 'use_imported' : idea.visualTask,
    } : idea));
  }, [availableLockedAssets, availableProducts, lockedProduct]);

  const handleSelectSceneVariant = useCallback((ideaId: string, assetId: string) => {
    setSceneIdeas((prev) => prev.map((idea) => {
      if (idea.id !== ideaId) return idea;
      const selectedVariant = idea.variants?.find((variant) => variant.assetId === assetId);
      return {
        ...idea,
        approved: false,
        route: selectedVariant?.route || idea.route,
        sourceMode: 'edit_from_asset',
        selectedVariantAssetId: assetId,
        linkedAssetId: assetId,
        linkedAssetDescription: selectedVariant?.description || idea.linkedAssetDescription,
        generationMode: selectedVariant?.generationMode || idea.generationMode,
        visualGap: false,
      };
    }));
  }, []);

  const handleUseSceneVariantAsBase = useCallback((ideaId: string, assetId: string) => {
    const idea = sceneIdeas.find((entry) => entry.id === ideaId);
    if (!idea) return;

    setSelectedSceneIdeaId(ideaId);
    setSelectedContinuationAssetId(assetId);
    setAssetLabMode(sceneRouteToAssetLabMode('continue_sequence'));
    setLockedAssetPrompt(idea.imagePrompt || idea.visualDescription || idea.text);
  }, [sceneIdeas, setAssetLabMode, setLockedAssetPrompt, setSelectedContinuationAssetId, setSelectedSceneIdeaId]);

  const handleRejectSceneVariant = useCallback((ideaId: string, assetId: string) => {
    setSceneIdeas((prev) => prev.map((idea) => {
      if (idea.id !== ideaId) return idea;
      const nextVariants = (idea.variants || []).filter((variant) => variant.assetId !== assetId);
      const selectedVariant = nextVariants.find((variant) => variant.assetId === idea.selectedVariantAssetId) || nextVariants[0];
      return {
        ...idea,
        approved: false,
        variants: nextVariants,
        selectedVariantAssetId: selectedVariant?.assetId,
        linkedAssetId: selectedVariant?.assetId,
        linkedAssetDescription: selectedVariant?.description,
        route: selectedVariant?.route || idea.route,
        generationMode: selectedVariant?.generationMode || idea.generationMode,
      };
    }));
  }, []);

  const handleApproveAllScenes = useCallback(() => {
    setSceneIdeas((prev) => prev.map((idea) => ({ ...idea, approved: true })));
  }, []);

  const handleFixRequirement = useCallback(async (type: 'hook' | 'proof' | 'closing' | 'approval' | 'unbound' | 'repetitive') => {
    if (!lockedProduct) return;

    if (type === 'approval') {
      handleApproveAllScenes();
      return;
    }

    if (type === 'unbound') {
      const defaultAsset = availableLockedAssets[0];
      if (!defaultAsset) return;

      const firstMissingVisual = sceneIdeas.find((idea) => {
        if (idea.selectedVariantAssetId) return false;
        if (idea.visualTask === 'generate_new') return true;
        if (idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product') return true;
        return !idea.baseAssetId;
      });

      setSceneIdeas((prev) => prev.map((idea) => {
        if (idea.selectedVariantAssetId) return idea;
        if (idea.visualTask === 'generate_new') return idea;
        if (idea.visualTask === 'edit_imported' || idea.visualTask === 'overlay_on_product') {
          if (idea.baseAssetId) return idea;
          return {
            ...idea,
            baseAssetId: defaultAsset.id,
            baseAssetDescription: defaultAsset.description,
            approved: false,
          };
        }
        if (idea.baseAssetId) return idea;
        return {
          ...idea,
          baseAssetId: defaultAsset.id,
          baseAssetDescription: defaultAsset.description,
          sourceMode: 'crop_reframe_asset',
          approved: false,
        };
      }));

      if (!firstMissingVisual) return;

      setSelectedSceneIdeaId(firstMissingVisual.id);
      if (firstMissingVisual.visualTask === 'generate_new') {
        setAssetLabMode(sceneRouteToAssetLabMode('generate_fresh'));
        setLockedAssetPrompt(firstMissingVisual.imagePrompt || firstMissingVisual.visualDescription || firstMissingVisual.text);
        return;
      }

      const continuationId = firstMissingVisual.baseAssetId || defaultAsset.id;
      setSelectedContinuationAssetId(continuationId);
      setAssetLabMode(sceneRouteToAssetLabMode(resolveSceneIdeaRoute(firstMissingVisual)));
      setLockedAssetPrompt(firstMissingVisual.imagePrompt || firstMissingVisual.visualDescription || firstMissingVisual.text);
      return;
    }

    setIsAddingSceneIdea(true);
    setErrorMessage(null);
    try {
      const promptMap = {
        hook: "High-energy scroll-stopping hook scene that introduces the product immediately.",
        proof: "Demonstration, texture, or 'reason-to-believe' scene showing the product benefit or results.",
        closing: "Final conversion-oriented hero shot with a clear call to action.",
        repetitive: "Vary the visual composition for the repetitive scenes to keep the viewer engaged."
      };
      
      const fixPrompt = (promptMap as any)[type] || "Add a fresh visual beat.";
      
      const assetSummary = availableLockedAssets
        .slice(0, 8)
        .map((asset, index) => summarizeLockedAsset(asset, index))
        .join('\n');
        
      const existingScenes = sceneIdeas.map((idea, index) => ({
        sceneNumber: index + 1,
        visualDescription: idea.visualDescription,
        imagePrompt: idea.imagePrompt,
        estimatedDuration: 3,
        scriptGuidance: idea.text,
      }));

      const generatedScene = await generateSingleScenePlan(
        `${lockedProduct.productTitle} for ${formatPlatformLabel(platform)}\nRetrieved product assets:\n${assetSummary}`,
        existingScenes,
        `${fixPrompt}\nFocus ONLY on fulfilling this missing requirement.`
      );

      const suggestedAssetIdx = (generatedScene as any).suggestedAssetIndex;
      const suggestedAsset = (suggestedAssetIdx > 0 && suggestedAssetIdx <= availableLockedAssets.length)
        ? availableLockedAssets[suggestedAssetIdx - 1]
        : null;

      setSceneIdeas((prev) => {
        const newIdea = {
          id: `scene_idea_fixed_${Date.now().toString(36)}`,
          text: generatedScene.scriptGuidance,
          visualDescription: generatedScene.visualDescription,
          imagePrompt: generatedScene.imagePrompt,
          approved: false,
          productId: lockedProduct.productId,
          productTitle: lockedProduct.productTitle,
          route: suggestedAsset ? 'composite_product' as const : 'generate_fresh' as const,
          sourceMode: 'generate_matching_shot' as const,
          agencySuggestedBaseAssetId: suggestedAsset?.id,
          agencySuggestedBaseAssetDescription: suggestedAsset?.description,
          agencySuggestedPrompt: generatedScene.imagePrompt,
          agencySuggestedRoute: suggestedAsset ? 'composite_product' as const : 'generate_fresh' as const,
          agencySuggestedMode: suggestedAsset ? 'continue_image_into_scene' as AssetLabMode : 'new_from_scene' as AssetLabMode,
        };
        if (type === 'hook') return [newIdea, ...prev];
        return [...prev, newIdea];
      });
    } catch (error: any) {
      console.error('[BrandVideoCreator] Requirement fix failed:', error);
      setErrorMessage(error.message || 'Could not fix the requirement automatically.');
    } finally {
      setIsAddingSceneIdea(false);
    }
  }, [availableLockedAssets, handleApproveAllScenes, lockedProduct, platform, sceneIdeas, setErrorMessage]);

  return {
    sceneIdeaPrompt,
    setSceneIdeaPrompt,
    sceneIdeas,
    setSceneIdeas,
    isAddingSceneIdea,
    agencySuggestedScenes,
    setAgencySuggestedScenes,
    agencySuggestedTrims,
    setAgencySuggestedTrims,
    sceneReorderPrompt,
    setSceneReorderPrompt,
    isReorderingScenes,
    sceneReorderReasoning,
    setSceneReorderReasoning,
    suggestedSceneOrderIds,
    excludedAssetIds,
    setExcludedAssetIds,
    narrativeArc,
    setNarrativeArc,
    creativeRationale,
    setCreativeRationale,
    lastProductLockUndoAction,
    setLastProductLockUndoAction,
    handleUpdateSceneIdea,
    handleUpdateSceneMotionMode,
    handleUpdateSceneRoute,
    handleToggleAssetExcluded,
    handleSuggestSceneOrder,
    handleAddSceneIdea,
    handleRemoveSceneIdea,
    handleUndoLastProductLockAction,
    handleMoveSceneIdea,
    handleApplySuggestedSceneOrder,
    handleUseSceneIdeaForAssetLab,
    handleAcceptAgencySuggestedScene,
    handleAssignSceneProduct,
    handleApproveSceneIdea,
    handleApproveAllScenes,
    handleBindSceneIdeaToSelectedAsset,
    handleAssignSceneBaseAsset,
    handleFixRequirement,
    handleSelectSceneVariant,
    handleUseSceneVariantAsBase,
    handleRejectSceneVariant,
  };
};
