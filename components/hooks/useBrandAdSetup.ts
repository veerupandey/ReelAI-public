import { useCallback } from 'react';
import type { Dispatch, SetStateAction } from 'react';
import type { AgentFinding } from '../../agents/types';
import type {
  Brand,
  BrandAsset,
  CampaignObjective,
  CampaignPlatform,
  ExecutionMode,
  ProductContext,
  ProductResolutionCandidate,
  ProductUniverse,
} from '../../types/brand';
import {
  addBrandAsset,
  createBrand,
  deleteBrand,
  getBrand,
  getBrands,
  saveBrand,
  updateBrandStatus,
} from '../../services/brandService';
import {
  BRIEF_ONLY_BRAND_NAME,
  BRIEF_ONLY_WEBSITE,
  bootstrapBrandDnaFromResearch,
  brandHasUsableDna,
  isBriefOnlyBrand,
  isResearchableBrandWebsite,
} from '../../services/brandDnaBootstrapService';
import { importProductPageAssets, importProductPageAssetsRich, importProductUniverse } from '../../services/productPageImportService';
import {
  getProductAssetHistory,
  registerProductAsset,
} from '../../services/productAssetRegistryService';
import { buildLockedProductContext, buildProductUniverse, resolveProductBrief } from '../../services/productResolverService';
import { analyzeProductAssets, suggestCampaignBriefPrompt } from '../../services/geminiService';

interface UseBrandAdSetupParams {
  userId: string;
  selectedBrand: Brand | null;
  setSelectedBrand: Dispatch<SetStateAction<Brand | null>>;
  campaignBrand: Brand | null;
  setCampaignBrand: Dispatch<SetStateAction<Brand | null>>;
  setBrands: Dispatch<SetStateAction<Brand[]>>;
  setStep: Dispatch<SetStateAction<'brand_hub' | 'product_import' | 'image_studio' | 'storyboard' | 'agents_working' | 'concept_review'>>;
  newBrandName: string;
  setNewBrandName: Dispatch<SetStateAction<string>>;
  newBrandUrl: string;
  setNewBrandUrl: Dispatch<SetStateAction<string>>;
  newBrandIg: string;
  setNewBrandIg: Dispatch<SetStateAction<string>>;
  setShowAddBrand: Dispatch<SetStateAction<boolean>>;
  briefText: string;
  setBriefText: Dispatch<SetStateAction<string>>;
  platform: CampaignPlatform;
  objective: CampaignObjective;
  durationSec: 10 | 15 | 20 | 30 | 45 | 60;
  executionMode: ExecutionMode;
  audience: string;
  callToAction: string;
  tone: string;
  setIsWritingBriefPrompt: Dispatch<SetStateAction<boolean>>;
  setIsResolvingProduct: Dispatch<SetStateAction<boolean>>;
  setCurrentPhase: Dispatch<SetStateAction<string>>;
  setLiveFindings: Dispatch<SetStateAction<AgentFinding[]>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setLockedProduct: Dispatch<SetStateAction<ProductContext | null>>;
  setProductUniverse: Dispatch<SetStateAction<ProductUniverse | null>>;
  productCandidates: ProductResolutionCandidate[];
  setProductCandidates: Dispatch<SetStateAction<ProductResolutionCandidate[]>>;
  setProductAssetHistory: Dispatch<SetStateAction<any[]>>;
  setExcludedAssetIds: Dispatch<SetStateAction<string[]>>;
  setLastProductLockUndoAction: Dispatch<SetStateAction<any>>;
  setSceneReorderReasoning: Dispatch<SetStateAction<string>>;
  setSceneIdeas: Dispatch<SetStateAction<any[]>>;
  setAgencySuggestedScenes: Dispatch<SetStateAction<any[]>>;
  setAgencyAutopilotProductId: Dispatch<SetStateAction<string | null>>;
  setSeededSceneProductId: Dispatch<SetStateAction<string | null>>;
  setLockedAssetPrompt: Dispatch<SetStateAction<string>>;
  setSceneIdeaPrompt: Dispatch<SetStateAction<string>>;
  normalizeUrlForKey: (value?: string) => string;
  titleFromProductUrl: (value?: string) => string;
  scopeBrandToProduct: (brand: Brand | null, productUrl?: string) => Brand | null;
}

export const useBrandAdSetup = ({
  userId,
  selectedBrand,
  setSelectedBrand,
  campaignBrand,
  setCampaignBrand,
  setBrands,
  setStep,
  newBrandName,
  setNewBrandName,
  newBrandUrl,
  setNewBrandUrl,
  newBrandIg,
  setNewBrandIg,
  setShowAddBrand,
  briefText,
  setBriefText,
  platform,
  objective,
  durationSec,
  executionMode,
  audience,
  callToAction,
  tone,
  setIsWritingBriefPrompt,
  setIsResolvingProduct,
  setCurrentPhase,
  setLiveFindings,
  setErrorMessage,
  setLockedProduct,
  setProductUniverse,
  productCandidates,
  setProductCandidates,
  setProductAssetHistory,
  setExcludedAssetIds,
  setLastProductLockUndoAction,
  setSceneReorderReasoning,
  setSceneIdeas,
  setAgencySuggestedScenes,
  setAgencyAutopilotProductId,
  setSeededSceneProductId,
  setLockedAssetPrompt,
  setSceneIdeaPrompt,
  normalizeUrlForKey,
  titleFromProductUrl,
  scopeBrandToProduct,
}: UseBrandAdSetupParams) => {
  const refreshBrandLists = useCallback((brand: Brand) => {
    setBrands((prev) => {
      const idx = prev.findIndex((b) => b.id === brand.id);
      if (idx < 0) return [...prev, brand];
      const next = [...prev];
      next[idx] = brand;
      return next;
    });
    setSelectedBrand((prev) => (prev?.id === brand.id ? brand : prev));
  }, [setBrands, setSelectedBrand]);

  const bootstrapDnaInBackground = useCallback(
    (brand: Brand) => {
      if (brandHasUsableDna(brand)) return;
      if (!isResearchableBrandWebsite(brand.websiteUrl)) return;
      // Reflect localStorage "researching" status in React so Brand Hub shows progress.
      refreshBrandLists({ ...brand, status: 'researching' });
      void bootstrapBrandDnaFromResearch(brand).then((updated) => {
        if (!updated) return;
        refreshBrandLists(updated);
      });
    },
    [refreshBrandLists],
  );

  const handleAddBrand = useCallback(() => {
    if (!(newBrandName || '').trim() || !(newBrandUrl || '').trim()) return;
    const brand = createBrand(
      userId,
      (newBrandName || '').trim(),
      (newBrandUrl || '').trim(),
      (newBrandIg || '').trim() || undefined,
    );
    setBrands((prev) => [...prev, brand]);
    setNewBrandName('');
    setNewBrandUrl('');
    setNewBrandIg('');
    setShowAddBrand(false);
    bootstrapDnaInBackground(brand);
  }, [
    bootstrapDnaInBackground,
    newBrandIg,
    newBrandName,
    newBrandUrl,
    setBrands,
    setNewBrandIg,
    setNewBrandName,
    setNewBrandUrl,
    setShowAddBrand,
    userId,
  ]);

  const handleDeleteBrand = useCallback((brandId: string) => {
    deleteBrand(brandId);
    setBrands((prev) => prev.filter((b) => b.id !== brandId));
    if (selectedBrand?.id === brandId) setSelectedBrand(null);
  }, [selectedBrand?.id, setBrands, setSelectedBrand]);

  const resetProductLockState = useCallback(() => {
    setCampaignBrand(null);
    setLockedProduct(null);
    setProductUniverse(null);
    setProductCandidates([]);
    setProductAssetHistory([]);
    setExcludedAssetIds([]);
    setLastProductLockUndoAction(null);
    setSceneReorderReasoning('');
    setSceneIdeas([]);
    setAgencySuggestedScenes([]);
    setAgencyAutopilotProductId(null);
    setSeededSceneProductId(null);
    setLockedAssetPrompt('');
    setSceneIdeaPrompt('');
  }, [
    setAgencyAutopilotProductId,
    setAgencySuggestedScenes,
    setCampaignBrand,
    setExcludedAssetIds,
    setLastProductLockUndoAction,
    setLockedAssetPrompt,
    setLockedProduct,
    setProductUniverse,
    setProductAssetHistory,
    setProductCandidates,
    setSceneIdeaPrompt,
    setSceneIdeas,
    setSceneReorderReasoning,
    setSeededSceneProductId,
  ]);

  const handleSelectBrand = useCallback((brand: Brand) => {
    const latest = getBrand(brand.id) ?? brand;
    setSelectedBrand(latest);
    resetProductLockState();
    setStep('product_import');
    bootstrapDnaInBackground(latest);
  }, [bootstrapDnaInBackground, resetProductLockState, setSelectedBrand, setStep]);

  /** Continue without a saved brand — reuses/creates a brief-only brand so import/generate/handoff keep working. */
  const handleSkipBrand = useCallback(() => {
    const existing = getBrands(userId).find((entry) => isBriefOnlyBrand(entry));
    const brand =
      existing ?? createBrand(userId, BRIEF_ONLY_BRAND_NAME, BRIEF_ONLY_WEBSITE);
    // Ready without website research — avoid stuck "researching" / failed DNA against brief.local.
    const ready =
      brand.status === 'ready'
        ? brand
        : updateBrandStatus(brand.id, 'ready') ?? { ...brand, status: 'ready' as const };
    setSelectedBrand(ready);
    resetProductLockState();
    setStep('product_import');
  }, [resetProductLockState, setSelectedBrand, setStep, userId]);

  const ensureBrandAssets = useCallback(async (brand: Brand | null, requestedProductUrl?: string): Promise<Brand | null> => {
    const targetUrl = normalizeUrlForKey(requestedProductUrl || brand?.websiteUrl);
    if (!brand || !targetUrl) {
      return brand;
    }

    const matchingAssets = brand.assets.filter((asset) => normalizeUrlForKey(asset.originPageUrl) === targetUrl);
    const hasMatchingAssets = matchingAssets.length > 0;
    if (brand.assets.length > 0 && hasMatchingAssets) {
      const needsIntelligence = matchingAssets.some((asset) => !asset.verdict || !asset.shotType || !asset.semanticDescription);
      if (!needsIntelligence) {
        return brand;
      }

      setCurrentPhase('🧠 Analyzing imported product visuals...');
      const enrichedAssets = await analyzeProductAssets({
        assets: matchingAssets,
        productTitle: titleFromProductUrl(targetUrl),
        brandName: brand.name,
        executionMode,
      });
      const enrichedById = new Map(enrichedAssets.map((asset) => [asset.id, asset]));
      const nextBrand = saveBrand({
        ...brand,
        assets: brand.assets.map((asset) => enrichedById.get(asset.id) || asset),
      });
      const nextBrands = getBrands(userId);
      setBrands(nextBrands);
      setSelectedBrand(nextBrand);
      setLiveFindings((prev) => [
        ...prev,
        {
          id: `asset_analysis_${Date.now().toString(36)}`,
          agentId: 'brand_import',
          timestamp: Date.now(),
          type: 'insight',
          title: 'Analyzed imported product visuals',
          content: `Reviewed ${enrichedAssets.length} existing product assets and attached scene-use recommendations.`,
          confidence: 0.9,
        },
      ].slice(-50));
      return nextBrand;
    }

    setCurrentPhase('📦 Importing product shots from website...');
    const importResult = await importProductPageAssetsRich(targetUrl, brand.name, {
      executionMode,
      analyzeAssets: true,
    });

    if (importResult.warnings.length > 0) {
      importResult.warnings.forEach((warning) => console.warn('[ensureBrandAssets]', warning));
    }

    const importedAssets = importResult.assets;
    if (!importedAssets.length) {
      if (importResult.warnings.length > 0) {
        setErrorMessage(importResult.warnings[0]);
      }
      return brand;
    }

    const existingAssetKeys = new Set(
      brand.assets.map((asset) => `${normalizeUrlForKey(asset.originPageUrl)}::${asset.sourceUrl || asset.previewUrl || asset.id}`),
    );
    const mergedAssets = [...brand.assets];
    importedAssets.forEach((asset) => {
      const assetKey = `${normalizeUrlForKey(asset.originPageUrl || targetUrl)}::${asset.sourceUrl || asset.previewUrl || asset.id}`;
      if (existingAssetKeys.has(assetKey)) return;
      existingAssetKeys.add(assetKey);
      mergedAssets.push(asset);
      addBrandAsset(brand.id, asset);
      registerProductAsset({
        brandName: brand.name,
        productUrl: asset.originPageUrl || targetUrl,
        productTitle: asset.sourceProductTitle || titleFromProductUrl(targetUrl),
        asset,
      });
    });

    const nextBrands = getBrands(userId);
    setBrands(nextBrands);
    const refreshedBrand = nextBrands.find((entry) => entry.id === brand.id) || brand;
    const mergedBrand: Brand = {
      ...refreshedBrand,
      assets: mergedAssets,
    };
    setSelectedBrand(mergedBrand);
    setLiveFindings((prev) => [
      ...prev,
      {
        id: `asset_import_${Date.now().toString(36)}`,
        agentId: 'brand_import',
        timestamp: Date.now(),
        type: 'asset',
        title: 'Imported product visuals',
        content: `Imported ${importedAssets.length} product shots from ${targetUrl}.${importedAssets.some((asset) => asset.verdict) ? ` ${importedAssets.filter((asset) => asset.verdict === 'use_as_is').length} are ready to use as-is and ${importedAssets.filter((asset) => asset.verdict === 'can_upgrade').length} are strong upgrade candidates.` : ''}`,
        confidence: 0.92,
      },
    ].slice(-50));
    return mergedBrand;
  }, [executionMode, normalizeUrlForKey, scopeBrandToProduct, setBrands, setCurrentPhase, setLiveFindings, setSelectedBrand, titleFromProductUrl, userId]);

  const handleResolveProduct = useCallback(async () => {
    if (!(briefText || '').trim()) return;
    setIsResolvingProduct(true);
    setErrorMessage(null);
    setCurrentPhase('🔎 Resolving exact product...');
    setLiveFindings([]);
    setLockedProduct(null);
    setProductCandidates([]);
    setSceneIdeas([]);
    setExcludedAssetIds([]);
    setLastProductLockUndoAction(null);
    setSceneReorderReasoning('');
    setAgencySuggestedScenes([]);
    setAgencyAutopilotProductId(null);
    setSeededSceneProductId(null);

    try {
      const resolution = await resolveProductBrief(selectedBrand, (briefText || '').trim());
      setProductCandidates(resolution.candidates);

      if (resolution.status === 'unresolved' || !selectedBrand) {
        setErrorMessage(resolution.reason || 'Could not resolve an exact product from the brief.');
        return;
      }

      if (resolution.status === 'ambiguous') {
        const explicitUrls = resolution.candidates
          .filter((candidate) => candidate.source === 'explicit_url')
          .map((candidate) => candidate.productUrl);

        if (selectedBrand && explicitUrls.length > 1) {
          setCurrentPhase('📦 Importing visuals from detected product URLs...');
          const importedProducts = await importProductUniverse(explicitUrls, selectedBrand.name, {
            executionMode,
            analyzeAssets: true,
          });

          if (importedProducts.length > 0) {
            const existingKeys = new Set(
              selectedBrand.assets.map((asset) => asset.sourceUrl || `${normalizeUrlForKey(asset.originPageUrl)}::${asset.description || ''}`),
            );
            const mergedAssets = [...selectedBrand.assets];
            let importedAssetCount = 0;

            importedProducts.forEach((product) => {
              product.assets.forEach((asset) => {
                const assetKey = asset.sourceUrl || `${normalizeUrlForKey(asset.originPageUrl)}::${asset.description || ''}`;
                if (existingKeys.has(assetKey)) return;
                existingKeys.add(assetKey);
                mergedAssets.push(asset);
                importedAssetCount += 1;
                registerProductAsset({
                  brandName: selectedBrand.name,
                  productUrl: asset.originPageUrl || product.productUrl,
                  productTitle: asset.sourceProductTitle || product.title,
                  asset,
                });
              });
            });

            if (importedAssetCount > 0) {
              const nextBrand = saveBrand({
                ...selectedBrand,
                assets: mergedAssets,
              });
              setBrands(getBrands(userId));
              setSelectedBrand(nextBrand);
              setLiveFindings((prev) => [
                ...prev,
                {
                  id: `multi_product_import_${Date.now().toString(36)}`,
                  agentId: 'brand_import',
                  timestamp: Date.now(),
                  type: 'asset',
                  title: 'Imported visuals for multiple provided product URLs',
                  content: `Imported ${importedAssetCount} assets across ${importedProducts.length} explicitly provided product pages so you can choose the exact campaign anchor next.`,
                  confidence: 0.92,
                },
              ].slice(-50));
            }
          }
        }

        setStep('product_lock');
        return;
      }

      const candidate = resolution.selectedCandidate;
      if (!candidate) {
        setErrorMessage('Could not lock an exact product for this campaign.');
        return;
      }

      const hydratedBrand = await ensureBrandAssets(selectedBrand, candidate.productUrl);
      const storedBrand = getBrands(userId).find((brand) => brand.id === selectedBrand.id) || null;
      const fullBrand = hydratedBrand || storedBrand || selectedBrand;
      let activeBrand = scopeBrandToProduct(fullBrand, candidate.productUrl);
      let effectiveBrand = fullBrand;
      if (!activeBrand || activeBrand.assets.length === 0) {
        setCurrentPhase('📦 Importing product shots from website...');
        const richResult = await importProductPageAssetsRich(candidate.productUrl, selectedBrand.name, {
          executionMode,
          analyzeAssets: true,
        });

        if (richResult.assets.length === 0) {
          const detail = richResult.warnings.length > 0
            ? richResult.warnings[0]
            : 'The exact product page was found, but no product images were imported for it.';
          setErrorMessage(detail);
          return;
        }

        const mergedBrand: Brand = {
          ...fullBrand,
          assets: [...fullBrand.assets, ...richResult.assets],
        };
        setSelectedBrand(mergedBrand);
        effectiveBrand = mergedBrand;
        activeBrand = scopeBrandToProduct(mergedBrand, candidate.productUrl);
        if (!activeBrand || activeBrand.assets.length === 0) {
          setErrorMessage('Product images were imported but could not be linked to the locked product. Try again or choose a different product URL.');
          return;
        }
      }

      const nextLockedProduct = buildLockedProductContext(effectiveBrand, candidate, {
        platform,
        durationSec,
      });
      const nextProductUniverse = buildProductUniverse(effectiveBrand, resolution.candidates, {
        platform,
        durationSec,
      }, candidate.productId);

      setCampaignBrand(activeBrand);
      setLockedProduct(nextLockedProduct);
      setProductUniverse(nextProductUniverse.products.length > 0 ? nextProductUniverse : {
        primaryProductId: nextLockedProduct.productId,
        products: [nextLockedProduct],
      });
      setExcludedAssetIds([]);
      setLastProductLockUndoAction(null);
      setSceneReorderReasoning('');
      setAgencySuggestedScenes([]);
      setAgencyAutopilotProductId(null);
      setSeededSceneProductId(null);
      setStep('product_lock');
    } catch (error: any) {
      console.error('[BrandVideoCreator] Product resolution failed:', error);
      setErrorMessage(error.message || 'Could not resolve the product from the brief.');
    } finally {
      setIsResolvingProduct(false);
    }
  }, [briefText, durationSec, ensureBrandAssets, platform, scopeBrandToProduct, selectedBrand, setAgencyAutopilotProductId, setAgencySuggestedScenes, setCampaignBrand, setErrorMessage, setExcludedAssetIds, setIsResolvingProduct, setLastProductLockUndoAction, setLiveFindings, setLockedProduct, setProductCandidates, setProductUniverse, setSceneIdeas, setSceneReorderReasoning, setSeededSceneProductId, setStep, setCurrentPhase, userId]);

  const handleChooseProductCandidate = useCallback(async (candidate: ProductResolutionCandidate) => {
    if (!selectedBrand) return;
    setErrorMessage(null);
    setCurrentPhase('📦 Locking product assets...');
    setIsResolvingProduct(true);

    try {
      const hydratedBrand = await ensureBrandAssets(selectedBrand, candidate.productUrl);
      const storedBrand = getBrands(userId).find((brand) => brand.id === selectedBrand.id) || null;
      const fullBrand = hydratedBrand || storedBrand || selectedBrand;
      const activeBrand = scopeBrandToProduct(fullBrand, candidate.productUrl);
      if (!activeBrand || activeBrand.assets.length === 0) {
        setErrorMessage('No product images were found for the selected product.');
        return;
      }

      const nextLockedProduct = buildLockedProductContext(fullBrand, candidate, {
        platform,
        durationSec,
      });
      const nextProductUniverse = buildProductUniverse(fullBrand, productCandidates.length > 0 ? productCandidates : [candidate], {
        platform,
        durationSec,
      }, candidate.productId);
      setCampaignBrand(activeBrand);
      setLockedProduct(nextLockedProduct);
      setProductUniverse(nextProductUniverse.products.length > 0 ? nextProductUniverse : {
        primaryProductId: nextLockedProduct.productId,
        products: [nextLockedProduct],
      });
      setExcludedAssetIds([]);
      setLastProductLockUndoAction(null);
      setSceneReorderReasoning('');
      setSceneIdeas([]);
      setAgencySuggestedScenes([]);
      setAgencyAutopilotProductId(null);
      setSeededSceneProductId(null);
      setLockedAssetPrompt('');
      setSceneIdeaPrompt('');
      setStep('product_lock');
    } catch (error: any) {
      console.error('[BrandVideoCreator] Candidate selection failed:', error);
      setErrorMessage(error.message || 'Could not lock that product.');
    } finally {
      setIsResolvingProduct(false);
    }
  }, [durationSec, ensureBrandAssets, platform, productCandidates, scopeBrandToProduct, selectedBrand, setAgencyAutopilotProductId, setAgencySuggestedScenes, setCampaignBrand, setCurrentPhase, setErrorMessage, setExcludedAssetIds, setIsResolvingProduct, setLastProductLockUndoAction, setLockedAssetPrompt, setLockedProduct, setProductUniverse, setSceneIdeaPrompt, setSceneIdeas, setSceneReorderReasoning, setSeededSceneProductId, setStep, userId]);

  const extractFirstUrl = useCallback((text: string): string | undefined => {
    const match = text.match(/https?:\/\/[^\s]+|(?:[a-z0-9-]+\.)+[a-z]{2,}(?:\/[^\s]*)?/i);
    if (!match) return undefined;
    const value = match[0];
    return value.startsWith('http') ? value : `https://${value}`;
  }, []);

  const handleSuggestCampaignBriefPrompt = useCallback(async () => {
    let productUrl = extractFirstUrl(briefText);
    if (!productUrl && selectedBrand) {
      const resolution = await resolveProductBrief(selectedBrand, briefText);
      if (resolution.status === 'ambiguous') {
        setErrorMessage(resolution.reason || 'Multiple products match that brief. Paste the product URL or name the product more specifically.');
        return;
      }
      productUrl = resolution.selectedCandidate?.productUrl || selectedBrand.websiteUrl;
    }
    productUrl = productUrl || selectedBrand?.websiteUrl;
    if (!productUrl) {
      setErrorMessage('Paste a product URL or mention the product name so AI can draft the brief around it.');
      return;
    }

    setIsWritingBriefPrompt(true);
    setErrorMessage(null);
    try {
      const nextPrompt = await suggestCampaignBriefPrompt({
        brandName: selectedBrand?.name,
        productUrl,
        platform,
        objective,
        durationSec,
        executionMode,
        audience: (audience || '').trim() || undefined,
        callToAction: (callToAction || '').trim() || undefined,
        tone: (tone || '').trim() || undefined,
        existingPrompt: (briefText || '').trim() || undefined,
      });
      setBriefText(nextPrompt);
    } catch (error: any) {
      console.error('[BrandVideoCreator] Campaign brief prompt suggestion failed:', error);
      setErrorMessage(error.message || 'AI could not draft the prompt from that product URL.');
    } finally {
      setIsWritingBriefPrompt(false);
    }
  }, [audience, briefText, callToAction, durationSec, executionMode, extractFirstUrl, objective, platform, selectedBrand, setBriefText, setErrorMessage, setIsWritingBriefPrompt, tone]);

  return {
    campaignBrand,
    handleAddBrand,
    handleDeleteBrand,
    handleSelectBrand,
    handleSkipBrand,
    ensureBrandAssets,
    handleResolveProduct,
    handleChooseProductCandidate,
    handleSuggestCampaignBriefPrompt,
    resetProductLockState,
  };
};
