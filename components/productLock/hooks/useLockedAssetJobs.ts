import { useCallback, useRef, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentFinding } from '../../../agents/types';
import { findReusableProductAsset } from '../../../services/productAssetRegistryService';
import { generateImageAsset, suggestSceneImageEdit } from '../../../services/geminiService';
import { assetLabModeToSceneRoute, sceneRouteToAssetLabMode } from '../../../services/sceneRouter';
import { buildRouteReferenceAssembly } from '../../../utils/sceneReferenceBuilder';
import type { AssetLabMode, BrandAsset, ProductContext, StoryboardSceneState } from '../../../types/brand';
import type { LockedAssetJobState } from '../productLockTypes';

interface UseLockedAssetJobsParams {
  lockedProduct: ProductContext | null;
  productUniverseProducts: ProductContext[];
  availableLockedAssets: BrandAsset[];
  excludedAssetIds: string[];
  sceneIdeas: StoryboardSceneState[];
  briefText: string;
  selectedSceneIdeaId: string;
  selectedContinuationAssetId: string;
  assetLabMode: AssetLabMode;
  lockedAssetPrompt: string;
  appendLockedProductAsset: (asset: BrandAsset) => void;
  setSceneIdeas: Dispatch<SetStateAction<StoryboardSceneState[]>>;
  setSelectedSceneIdeaId: Dispatch<SetStateAction<string>>;
  setActiveProductId: Dispatch<SetStateAction<string>>;
  setSelectedContinuationAssetId: Dispatch<SetStateAction<string>>;
  setLockedAssetPrompt: Dispatch<SetStateAction<string>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setLiveFindings: Dispatch<SetStateAction<AgentFinding[]>>;
}

interface UseLockedAssetJobsResult {
  lockedAssetJobs: Record<string, LockedAssetJobState>;
  isSuggestingLockedAssetPrompt: boolean;
  isGeneratingSelectedSceneAsset: boolean;
  selectedSceneLockedAssetActionIndex: number | null;
  handleGenerateLockedAsset: (
    assetIndex?: number,
    promptOverride?: string,
    sceneIdeaIdOverride?: string,
    modeOverride?: AssetLabMode,
    forceNewGeneration?: boolean,
  ) => Promise<void>;
  handleQuickGenerateSceneAsset: (ideaId: string) => Promise<void>;
  handleCancelSceneAssetJob: (ideaId: string) => void;
  handleSmartEditLockedAsset: (assetIndex: number) => Promise<void>;
  handleSuggestLockedAssetPrompt: () => Promise<void>;
}

export const useLockedAssetJobs = ({
  lockedProduct,
  productUniverseProducts,
  availableLockedAssets,
  excludedAssetIds,
  sceneIdeas,
  briefText,
  selectedSceneIdeaId,
  selectedContinuationAssetId,
  assetLabMode,
  lockedAssetPrompt,
  appendLockedProductAsset,
  setSceneIdeas,
  setSelectedSceneIdeaId,
  setActiveProductId,
  setSelectedContinuationAssetId,
  setLockedAssetPrompt,
  setErrorMessage,
  setLiveFindings,
}: UseLockedAssetJobsParams): UseLockedAssetJobsResult => {
  const [isSuggestingLockedAssetPrompt, setIsSuggestingLockedAssetPrompt] = useState(false);
  const [lockedAssetJobs, setLockedAssetJobs] = useState<Record<string, LockedAssetJobState>>({});
  const cancelledLockedAssetRunsRef = useRef<Set<string>>(new Set());

  const selectedSceneJobKey = selectedSceneIdeaId || 'unselected';
  const selectedSceneJob = lockedAssetJobs[selectedSceneJobKey];
  const isGeneratingSelectedSceneAsset = Boolean(selectedSceneJob?.isGenerating);
  const selectedSceneLockedAssetActionIndex = selectedSceneJob?.assetIndex ?? null;

  const resolveSceneProduct = useCallback((idea?: StoryboardSceneState): ProductContext | null => {
    if (idea?.productId) {
      const matched = productUniverseProducts.find((product) => product.productId === idea.productId);
      if (matched) return matched;
    }
    return lockedProduct;
  }, [lockedProduct, productUniverseProducts]);

  const getAssetsForProduct = useCallback((product: ProductContext | null | undefined): BrandAsset[] => {
    if (!product) return [];
    return product.productAssets.filter((asset) => !excludedAssetIds.includes(asset.id));
  }, [excludedAssetIds]);

  const handleGenerateLockedAsset = useCallback(async (
    assetIndex?: number,
    promptOverride?: string,
    sceneIdeaIdOverride?: string,
    modeOverride?: AssetLabMode,
    forceNewGeneration?: boolean,
  ) => {
    if (!lockedProduct) return;
    const promptText = (promptOverride || lockedAssetPrompt || '').trim();
    if (!promptText) {
      setErrorMessage('Add an image direction first so AI knows what to create.');
      return;
    }

    const targetSceneIdeaId = sceneIdeaIdOverride || selectedSceneIdeaId || sceneIdeas[0]?.id;
    const selectedSceneIdea = sceneIdeas.find((idea) => idea.id === targetSceneIdeaId);
    const sceneLockedProduct = resolveSceneProduct(selectedSceneIdea) || lockedProduct;
    const sceneLockedAssets = getAssetsForProduct(sceneLockedProduct);
    const jobKey = selectedSceneIdea?.id || `unselected_${Date.now().toString(36)}`;
    const resolvedMode = modeOverride || assetLabMode || selectedSceneIdea?.generationMode || 'continue_image_into_scene';
    const resolvedRoute = assetLabModeToSceneRoute(resolvedMode);
    const requiresReference = resolvedMode !== 'scene_prompt_only' && resolvedMode !== 'new_from_scene';
    const selectedAssetPool = sceneLockedAssets.length > 0 ? sceneLockedAssets : availableLockedAssets;
    const selectedAssetIndexWithinPool = typeof assetIndex === 'number'
      ? assetIndex
      : selectedAssetPool.findIndex((asset) => asset.id === selectedContinuationAssetId);
    const effectiveSelectedAsset = selectedAssetIndexWithinPool >= 0 ? selectedAssetPool[selectedAssetIndexWithinPool] : undefined;
    const fallbackAsset = selectedAssetPool[0];
    const resolvedReferenceAsset = requiresReference ? (effectiveSelectedAsset || fallbackAsset) : undefined;
    const referenceAssembly = buildRouteReferenceAssembly({
      route: resolvedRoute,
      scene: {
        imagePrompt: promptText,
        visualDescription: selectedSceneIdea?.visualDescription || promptText,
        voiceoverText: selectedSceneIdea?.text || briefText,
        onScreenText: selectedSceneIdea?.text || briefText,
        sceneReferenceBindings: undefined,
      },
      productAnchor: resolvedReferenceAsset ? {
        assetId: resolvedReferenceAsset.id,
        source: 'brand_asset',
        role: 'product',
        label: resolvedReferenceAsset.description || sceneLockedProduct?.productTitle || lockedProduct?.productTitle || 'Product anchor',
        description: resolvedReferenceAsset.description,
        previewUrl: resolvedReferenceAsset.previewUrl,
        mimeType: resolvedReferenceAsset.mimeType,
        base64: resolvedReferenceAsset.base64,
      } : undefined,
    });
    const referenceSourceAssetIds = referenceAssembly.sourceAssetIds;
    const referenceProvenance = referenceAssembly.provenance;
    if (requiresReference && !resolvedReferenceAsset) {
      setErrorMessage('Select or keep a locked product image attached for this generation mode.');
      return;
    }
    if ((resolvedMode === 'new_from_scene' || resolvedMode === 'continue_image_into_scene') && !selectedSceneIdea) {
      setErrorMessage('Select a scene idea first for this generation mode.');
      return;
    }

    const reusableAsset = !forceNewGeneration ? findReusableProductAsset({
      assets: selectedAssetPool,
      productUrl: sceneLockedProduct?.productUrl || lockedProduct?.productUrl || '',
      promptText,
      sceneText: selectedSceneIdea?.text || selectedSceneIdea?.visualDescription,
      derivedFromAssetId: resolvedReferenceAsset?.id,
      sourceAssetIds: referenceSourceAssetIds,
      provenance: referenceProvenance,
    }) : undefined;
    if (reusableAsset) {
      setLiveFindings((prev) => [
        ...prev,
        {
          id: `asset_reuse_${reusableAsset.id}_${Date.now().toString(36)}`,
          agentId: 'asset_registry',
          timestamp: Date.now(),
          type: 'asset',
          title: 'Reused a matching local product asset',
          content: `Skipped a new generation and reused ${reusableAsset.description || 'a previously generated asset'} for ${sceneLockedProduct?.productTitle || lockedProduct?.productTitle}.`,
          confidence: 0.96,
        },
      ].slice(-50));
      if (selectedSceneIdea) {
        setSceneIdeas((prev) => prev.map((idea) => idea.id === selectedSceneIdea.id ? {
          ...idea,
          approved: false,
          route: resolvedRoute,
          sourceMode: 'edit_from_asset',
          productId: sceneLockedProduct?.productId || idea.productId,
          productTitle: sceneLockedProduct?.productTitle || idea.productTitle,
          baseAssetId: resolvedReferenceAsset?.id || idea.baseAssetId,
          baseAssetDescription: resolvedReferenceAsset?.description || idea.baseAssetDescription,
          generationMode: resolvedMode,
          linkedAssetId: reusableAsset.id,
          linkedAssetDescription: reusableAsset.description,
          selectedVariantAssetId: reusableAsset.id,
          variants: [
            ...(idea.variants || []).filter((variant) => variant.assetId !== reusableAsset.id),
            {
              assetId: reusableAsset.id,
              description: reusableAsset.description,
              previewUrl: reusableAsset.previewUrl,
              route: resolvedRoute,
              generationMode: resolvedMode,
              createdAt: Date.now(),
              sourceAssetIds: reusableAsset.sourceAssetIds,
              provenance: reusableAsset.provenance,
            },
          ],
          imagePrompt: promptText,
        } : idea));
      }
      setLockedAssetPrompt('');
      return;
    }

    setErrorMessage(null);
    const runId = `locked_job_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
    setLockedAssetJobs((prev) => ({
      ...prev,
      [jobKey]: {
        isGenerating: true,
        assetIndex: resolvedReferenceAsset ? (selectedAssetIndexWithinPool >= 0 ? selectedAssetIndexWithinPool : 0) : null,
        runId,
      },
    }));

    try {
      const modePromptMap: Record<AssetLabMode, string[]> = {
        scene_prompt_only: [
          promptText,
          'Generate a new locked-product image from the prompt only.',
          'Do not treat this as a continuation shot. Keep product identity exact.',
        ],
        continue_image: [
          promptText,
          'Create the next shot in the same sequence as the referenced image.',
          'Preserve camera lineage, subject continuity, and exact product identity.',
        ],
        continue_image_into_scene: [
          promptText,
          selectedSceneIdea ? `Scene continuation target: ${selectedSceneIdea.text}. Visual direction: ${selectedSceneIdea.visualDescription}.` : '',
          'Create the next shot after the referenced image, but evolve it into the selected scene.',
          'Preserve exact product identity and make the result feel sequential, not disconnected.',
        ],
        image_variant: [
          promptText,
          'Create a close variant of the referenced image.',
          'Keep the same shot family and exact product identity, with small compositional or styling changes only.',
        ],
        new_from_scene: [
          promptText,
          selectedSceneIdea ? `Selected scene: ${selectedSceneIdea.text}. Visual direction: ${selectedSceneIdea.visualDescription}.` : '',
          'Create a fresh scene-led image grounded in the locked product context.',
          'Do not try to continue a previous image sequence unless explicitly stated in the prompt.',
        ],
      };
      const finalPrompt = modePromptMap[resolvedMode].filter(Boolean).join('\n');
      const generatedBase64 = await generateImageAsset({
        mode: resolvedReferenceAsset ? 'edit' : 'generate',
        imagePrompt: finalPrompt,
        visualDescription: selectedSceneIdea?.visualDescription || promptText,
        currentSceneText: selectedSceneIdea?.text || sceneIdeas.map((idea) => idea.text).join(' | ') || briefText,
        brandContext: [
          `Locked product: ${sceneLockedProduct?.productTitle || lockedProduct?.productTitle}`,
          `Brand: ${sceneLockedProduct?.brandName || lockedProduct?.brandName}`,
          'Preserve the exact same product identity, label, packaging text, bottle shape, cap, and proportions.',
          resolvedMode === 'continue_image' || resolvedMode === 'continue_image_into_scene'
            ? 'Treat the selected reference image as the previous shot in a sequence.'
            : resolvedMode === 'image_variant'
              ? 'Treat the selected reference image as the base composition to vary slightly.'
              : 'Use the locked product references for grounding, not necessarily for sequential continuation.',
        ].join(' | '),
        primaryReference: resolvedReferenceAsset?.base64 ? {
          data: resolvedReferenceAsset.base64,
          mimeType: resolvedReferenceAsset.mimeType,
          assetId: resolvedReferenceAsset.id,
        } : undefined,
      });

      if (cancelledLockedAssetRunsRef.current.has(runId)) {
        cancelledLockedAssetRunsRef.current.delete(runId);
        return;
      }

      const nextAsset: BrandAsset = {
        id: `locked_generated_${Date.now().toString(36)}`,
        type: 'generated',
        base64: generatedBase64,
        mimeType: 'image/png',
        description: selectedSceneIdea?.visualDescription || promptText,
        previewUrl: `data:image/png;base64,${generatedBase64}`,
        originPageUrl: sceneLockedProduct?.productUrl || lockedProduct?.productUrl,
        sourceProductTitle: sceneLockedProduct?.productTitle || lockedProduct?.productTitle,
        generationPrompt: promptText,
        derivedFromAssetId: resolvedReferenceAsset?.id,
        sourceAssetIds: referenceSourceAssetIds,
        provenance: referenceProvenance,
        createdAt: new Date().toISOString(),
      };

      appendLockedProductAsset(nextAsset);
      if (selectedSceneIdea) {
        setSceneIdeas((prev) => prev.map((idea) => idea.id === selectedSceneIdea.id ? {
          ...idea,
          approved: false,
          route: resolvedRoute,
          productId: sceneLockedProduct?.productId || idea.productId,
          productTitle: sceneLockedProduct?.productTitle || idea.productTitle,
          sourceMode: resolvedReferenceAsset ? 'edit_from_asset' : 'generate_matching_shot',
          baseAssetId: resolvedReferenceAsset?.id || idea.baseAssetId,
          baseAssetDescription: resolvedReferenceAsset?.description || idea.baseAssetDescription,
          generationMode: resolvedMode,
          linkedAssetId: nextAsset.id,
          linkedAssetDescription: nextAsset.description,
          selectedVariantAssetId: nextAsset.id,
          variants: [
            ...(idea.variants || []),
            {
              assetId: nextAsset.id,
              description: nextAsset.description,
              previewUrl: nextAsset.previewUrl,
              route: resolvedRoute,
              generationMode: resolvedMode,
              createdAt: Date.now(),
              sourceAssetIds: nextAsset.sourceAssetIds,
              provenance: nextAsset.provenance,
            },
          ],
          imagePrompt: promptText,
        } : idea));
      }
      setLockedAssetPrompt('');
    } catch (error: any) {
      console.error('[BrandVideoCreator] Locked asset generation failed:', error);
      setErrorMessage(error.message || 'AI could not create that locked-product image.');
    } finally {
      setLockedAssetJobs((prev) => ({
        ...prev,
        [jobKey]: {
          isGenerating: false,
          assetIndex: null,
          runId: prev[jobKey]?.runId,
        },
      }));
    }
  }, [
    appendLockedProductAsset,
    assetLabMode,
    availableLockedAssets,
    briefText,
    getAssetsForProduct,
    lockedAssetPrompt,
    lockedProduct,
    resolveSceneProduct,
    sceneIdeas,
    selectedContinuationAssetId,
    selectedSceneIdeaId,
    setActiveProductId,
    setErrorMessage,
    setLiveFindings,
    setLockedAssetPrompt,
    setSceneIdeas,
  ]);

  const handleQuickGenerateSceneAsset = useCallback(async (ideaId: string) => {
    if (!lockedProduct) return;
    const idea = sceneIdeas.find((entry) => entry.id === ideaId);
    if (!idea) return;

    const sceneLockedProduct = resolveSceneProduct(idea) || lockedProduct;
    const sceneLockedAssets = getAssetsForProduct(sceneLockedProduct);
    const preferredAssetId = idea.baseAssetId || idea.agencySuggestedBaseAssetId || selectedContinuationAssetId;
    const assetIndex = preferredAssetId
      ? sceneLockedAssets.findIndex((asset) => asset.id === preferredAssetId)
      : 0;

    setSelectedSceneIdeaId(ideaId);
    setActiveProductId(sceneLockedProduct?.productId || '');
    if (preferredAssetId) {
      setSelectedContinuationAssetId(preferredAssetId);
    }
    setLockedAssetPrompt(idea.imagePrompt || idea.visualDescription || idea.text);
    await handleGenerateLockedAsset(
      assetIndex >= 0 ? assetIndex : undefined,
      idea.imagePrompt || idea.visualDescription || idea.text,
      ideaId,
      idea.route
        ? sceneRouteToAssetLabMode(idea.route)
        : idea.agencySuggestedRoute
          ? sceneRouteToAssetLabMode(idea.agencySuggestedRoute)
          : idea.generationMode || idea.agencySuggestedMode || assetLabMode,
      true // Force new generation instead of instantly reusing a cached response
    );
  }, [
    assetLabMode,
    getAssetsForProduct,
    handleGenerateLockedAsset,
    lockedProduct,
    resolveSceneProduct,
    sceneIdeas,
    selectedContinuationAssetId,
    setActiveProductId,
    setLockedAssetPrompt,
    setSelectedContinuationAssetId,
    setSelectedSceneIdeaId,
  ]);

  const handleCancelSceneAssetJob = useCallback((ideaId: string) => {
    const job = lockedAssetJobs[ideaId];
    if (!job?.isGenerating || !job.runId) return;

    cancelledLockedAssetRunsRef.current.add(job.runId);
    setLockedAssetJobs((prev) => ({
      ...prev,
      [ideaId]: {
        ...prev[ideaId],
        isGenerating: false,
        assetIndex: null,
      },
    }));
    setLiveFindings((prev) => [
      ...prev,
      {
        id: `asset_cancel_${ideaId}_${Date.now().toString(36)}`,
        agentId: 'asset_registry',
        timestamp: Date.now(),
        type: 'status',
        title: 'Scene asset generation cancelled',
        content: `Cancelled the in-flight asset job for scene ${sceneIdeas.findIndex((idea) => idea.id === ideaId) + 1}. Late results will be ignored.`,
        confidence: 0.92,
      },
    ].slice(-50));
  }, [lockedAssetJobs, sceneIdeas, setLiveFindings]);

  const handleSmartEditLockedAsset = useCallback(async (assetIndex: number) => {
    if (!availableLockedAssets[assetIndex] || !lockedProduct) return;
    const asset = availableLockedAssets[assetIndex];
    const selectedSceneIdea = sceneIdeas.find((idea) => idea.id === selectedSceneIdeaId);
    const jobKey = selectedSceneIdea?.id || 'unselected';
    const sceneJob = lockedAssetJobs[jobKey];
    if (sceneJob?.isGenerating) {
      setErrorMessage('That scene is already generating an asset.');
      return;
    }
    setErrorMessage(null);
    try {
      const sceneLockedProduct = resolveSceneProduct(selectedSceneIdea) || lockedProduct;
      const suggestion = await suggestSceneImageEdit({
        base64: asset.base64,
        mimeType: asset.mimeType,
        description: asset.description,
        imagePrompt: lockedAssetPrompt || asset.description,
      }, {
        sceneText: sceneIdeas.map((idea) => idea.text).join(' | ') || briefText,
        brandContext: `Locked product: ${sceneLockedProduct?.productTitle || lockedProduct?.productTitle} | Brand: ${sceneLockedProduct?.brandName || lockedProduct?.brandName}`,
        sourceHint: 'locked_product_screen',
      });
      setLockedAssetPrompt(suggestion.imagePrompt);
      await handleGenerateLockedAsset(assetIndex, suggestion.imagePrompt);
    } catch (error: any) {
      console.error('[BrandVideoCreator] Locked asset AI edit failed:', error);
      setErrorMessage(error.message || 'AI could not edit that product image.');
    }
  }, [
    availableLockedAssets,
    briefText,
    handleGenerateLockedAsset,
    lockedAssetJobs,
    lockedAssetPrompt,
    lockedProduct,
    resolveSceneProduct,
    sceneIdeas,
    selectedSceneIdeaId,
    setErrorMessage,
    setLockedAssetPrompt,
  ]);

  const handleSuggestLockedAssetPrompt = useCallback(async () => {
    if (!lockedProduct) return;

    const selectedSceneIdea = sceneIdeas.find((idea) => idea.id === selectedSceneIdeaId) || sceneIdeas[0];
    if (!selectedSceneIdea) {
      setErrorMessage('Select a scene first so AI can suggest a relevant image prompt.');
      return;
    }
    const sceneLockedProduct = resolveSceneProduct(selectedSceneIdea) || lockedProduct;
    const sceneLockedAssets = getAssetsForProduct(sceneLockedProduct);

    const selectedAsset = sceneLockedAssets.find((asset) => asset.id === selectedContinuationAssetId)
      || sceneLockedAssets.find((asset) => asset.id === selectedSceneIdea.baseAssetId)
      || sceneLockedAssets[0];

    if (!selectedAsset) {
      setErrorMessage('Select or import at least one product image first.');
      return;
    }

    setIsSuggestingLockedAssetPrompt(true);
    setErrorMessage(null);
    try {
      const sceneIndex = sceneIdeas.findIndex((idea) => idea.id === selectedSceneIdea.id);
      const suggestion = await suggestSceneImageEdit({
        base64: selectedAsset.base64,
        mimeType: selectedAsset.mimeType,
        description: selectedAsset.description,
        imagePrompt: selectedSceneIdea.imagePrompt || lockedAssetPrompt || selectedAsset.description,
      }, {
        sceneText: selectedSceneIdea.text,
        previousSceneText: sceneIndex > 0 ? (sceneIdeas[sceneIndex - 1].text || sceneIdeas[sceneIndex - 1].visualDescription) : undefined,
        nextSceneText: sceneIndex >= 0 && sceneIndex < sceneIdeas.length - 1 ? (sceneIdeas[sceneIndex + 1].text || sceneIdeas[sceneIndex + 1].visualDescription) : undefined,
        brandContext: `Locked product: ${sceneLockedProduct?.productTitle || lockedProduct?.productTitle} | Brand: ${sceneLockedProduct?.brandName || lockedProduct?.brandName} | Preserve exact product identity and packaging. Route: ${assetLabModeToSceneRoute(assetLabMode)}`,
        sourceHint: 'selected_scene_asset_prompt',
      });

      setSelectedSceneIdeaId(selectedSceneIdea.id);
      setActiveProductId(sceneLockedProduct?.productId || '');
      setSelectedContinuationAssetId(selectedAsset.id);
      setLockedAssetPrompt(suggestion.imagePrompt);
    } catch (error: any) {
      console.error('[BrandVideoCreator] Locked asset prompt suggestion failed:', error);
      setErrorMessage(error.message || 'AI could not suggest a prompt for this scene.');
    } finally {
      setIsSuggestingLockedAssetPrompt(false);
    }
  }, [
    assetLabMode,
    lockedAssetPrompt,
    getAssetsForProduct,
    lockedProduct,
    resolveSceneProduct,
    sceneIdeas,
    selectedContinuationAssetId,
    selectedSceneIdeaId,
    setErrorMessage,
    setActiveProductId,
    setLockedAssetPrompt,
    setSelectedContinuationAssetId,
    setSelectedSceneIdeaId,
  ]);

  return {
    lockedAssetJobs,
    isSuggestingLockedAssetPrompt,
    isGeneratingSelectedSceneAsset,
    selectedSceneLockedAssetActionIndex,
    handleGenerateLockedAsset,
    handleQuickGenerateSceneAsset,
    handleCancelSceneAssetJob,
    handleSmartEditLockedAsset,
    handleSuggestLockedAssetPrompt,
  };
};
