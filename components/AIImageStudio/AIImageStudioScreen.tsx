import React, { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AspectRatio,
  BrandComplianceCheck,
  StudioAsset,
  HistoryEntry,
  ReferenceRole,
  RoleAssignment,
} from './types';
import { useStudioReducer } from './useStudioReducer';
import { generateStudioImage, enhanceStudioPrompt, buildStudioGenerationRequest, executeGeneration } from './studioService';
import { importFiles, importFromUrl } from './assetIngestion';
import { useIsMobile } from './useIsMobile';
import EmptyState from './EmptyState';
import AssetCollectionStep from './AssetCollectionStep';
import StudioToolbar from './StudioToolbar';
import AssetGallery from './AssetGallery';
import GenerationPanel from './GenerationPanel';
import AssetDetailPanel from './AssetDetailPanel';
import CreativeAssistantPanel from './CreativeAssistantPanel';
import ProductTruthPanel from './ProductTruthPanel';
import RoleAssignmentSheet from './RoleAssignmentSheet';
import StudioLightbox, {
  getLightboxReviewAssets,
  ITERATE_PROMPTS,
  type IterateAction,
} from './StudioLightbox';
import VideoStudioPanel from './VideoStudioPanel';
import StudioCompareView from './StudioCompareView';
import { downloadStudioExportPack } from './exportPackService';
import { evaluateBrandCompliance } from './brandComplianceService';
import { generateStudioCaption, getCaptionCarouselSlides, getPostQueueSlides } from './captionService';
import InstagramPostPanel from './InstagramPostPanel';
import { mergeLockedReferences, resolveGenerationReferences } from './creativeCopilotService';
import {
  mergeProductAssets,
  refreshProductTruth,
  signalsFromProductUrl,
} from './productTruthOrchestration';
import { researchBrand, normalizeBrandUrls } from './brandKnowledgeService';
import PlannerModelControls from '../PlannerModelControls';
import ImageModelControls from '../ImageModelControls';
import { getPlannerModelOption } from '../../services/llm/catalog';
import { getStoredPreferredPlannerModel } from '../../services/llm/apiKeys';
import { DEFAULT_PLANNER_MODEL, type PlannerModelId } from '../../services/llm/types';
import { buildBrandAestheticsBrief } from './creativeContextService';
import { parseStudioEnhanceIntent } from './enhanceIntentService';
import { buildPreliminaryProductTruth } from './productTruthService';
import {
  referenceRoleToComposer,
  roleAssignmentToInstructions,
  seedRoleAssignment,
} from './referenceRoleMapping';
import { saveAssetToDisk } from './diskSaveService';
import type { CreativeConcept, CaptionTone, StudioCaptionPack, StrategistBrief } from './types';
import type { PromptWriterSeed } from './PromptWriter';
import type { PromptWriterSlide } from './promptWriterService';
import StudioProjectMenu from './StudioProjectMenu';
import {
  evaluateExportCompliance,
  formatExportComplianceMessage,
  readExportComplianceMode,
  writeExportComplianceMode,
  type ExportComplianceMode,
} from './exportComplianceGate';
import { formatStrategistBriefForPrompt } from './strategistBriefService';
import { buildBatchVariationDirective } from './variationDirections';
import { buildAdaptFormatRequest, formatAdaptTargetLabel } from './adaptFormatService';

type StudioStep = 'landing' | 'import' | 'studio';

export interface AIImageStudioScreenProps {}

/** Toast notification type */
interface Toast {
  id: string;
  message: string;
  type: 'error' | 'success';
  autoDismiss: boolean;
}

function buildConceptWriterSeed(
  concept: CreativeConcept,
  strategistBrief?: StrategistBrief,
): PromptWriterSeed {
  const parts = [
    `Concept: ${concept.title}`,
    concept.oneLineIdea,
    '',
    'Visual direction:',
    concept.visualDirection,
  ];
  if (concept.hook) parts.push('', `Hook: ${concept.hook}`);
  if (concept.negativePrompt) parts.push('', `Avoid: ${concept.negativePrompt}`);
  if (strategistBrief) {
    parts.push('', formatStrategistBriefForPrompt(strategistBrief));
  }
  if (concept.productTruthNotes.length > 0) {
    parts.push('', 'Product notes:', ...concept.productTruthNotes.map((note) => `- ${note}`));
  }
  parts.push('', 'Write a production-ready image generation prompt that executes this concept.');
  return {
    instruction: parts.join('\n'),
    slideCount: 1,
  };
}

/**
 * AIImageStudioScreen — top-level route component for the AI Image Studio.
 * Orchestrates state management, generation lifecycle, enhancement lifecycle,
 * file upload, URL import, and drag-and-drop.
 *
 * Requirements: 6.5, 6.6, 6.7, 6.9, 7.3, 7.5, 8.6, 11.5
 */
const AIImageStudioScreen: React.FC<AIImageStudioScreenProps> = () => {
  const [state, dispatch] = useStudioReducer();

  // Load step from localStorage on mount
  const [step, setStep] = useState<StudioStep>(() => {
    if (typeof window === 'undefined') return 'landing';
    try {
      const saved = localStorage.getItem('ai-image-studio-step-v1');
      if (saved === 'landing' || saved === 'import' || saved === 'studio') return saved;
    } catch { /* ignore */ }
    return 'landing';
  });

  const [toasts, setToasts] = useState<Toast[]>([]);
  const [urlModalOpen, setUrlModalOpen] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [bottomSheetOpen, setBottomSheetOpen] = useState(false);
  const [showAssistant, setShowAssistant] = useState(false);
  const [promptWriterSeed, setPromptWriterSeed] = useState<PromptWriterSeed | null>(null);
  const [promptWriterOpenToken, setPromptWriterOpenToken] = useState(0);
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [videoStudioAssetId, setVideoStudioAssetId] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<{ leftId: string; rightId: string } | null>(null);
  const [variationCount, setVariationCount] = useState(1);
  const [batchProgress, setBatchProgress] = useState<{
    completed: number;
    total: number;
    failed: number;
    running: boolean;
  } | null>(null);
  const batchCancelledRef = useRef(false);
  const handleStopBatch = useCallback(() => {
    batchCancelledRef.current = true;
    setBatchProgress((prev) => (prev ? { ...prev, running: false } : prev));
  }, []);
  const [roleAssignmentOpen, setRoleAssignmentOpen] = useState(false);
  const [roleDraft, setRoleDraft] = useState(() => new Map<string, RoleAssignment>());
  const [exportComplianceMode, setExportComplianceMode] = useState<ExportComplianceMode>(() =>
    readExportComplianceMode(),
  );
  const [isCaptionGenerating, setIsCaptionGenerating] = useState(false);
  const [captionProgressMessage, setCaptionProgressMessage] = useState<string | null>(null);
  const [showPostComposer, setShowPostComposer] = useState(false);
  const [showTextModel, setShowTextModel] = useState(false);
  const [showImageModel, setShowImageModel] = useState(false);
  const [textModel, setTextModel] = useState<PlannerModelId>(
    () => getStoredPreferredPlannerModel() || DEFAULT_PLANNER_MODEL,
  );

  const isMobile = useIsMobile();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const galleryRef = useRef<HTMLDivElement>(null);

  // Persist step to localStorage when it changes
  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      localStorage.setItem('ai-image-studio-step-v1', step);
    } catch { /* ignore quota errors */ }
  }, [step]);

  // Escape closes Creative Assistant even when focus is outside the panel.
  useEffect(() => {
    if (!showAssistant) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      setShowAssistant(false);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [showAssistant]);

  // After refresh / tab restore: if we have assets, land in the studio (not the empty landing).
  useEffect(() => {
    if (state.assets.length > 0 && step === 'landing') {
      setStep('studio');
    }
  }, [state.assets.length, step]);

  // --- Toast management ---

  const addToast = useCallback((message: string, type: 'error' | 'success', autoDismiss: boolean) => {
    const id = crypto.randomUUID();
    setToasts((prev) => [{ id, message, type, autoDismiss }, ...prev]);

    if (autoDismiss) {
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
      }, 5000);
    }
  }, []);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  // --- File upload ---

  const handleUploadClick = useCallback(() => {
    fileInputRef.current?.click();
  }, []);

  const establishProductTruthFromImport = useCallback(
    (incoming: StudioAsset[], signals?: Parameters<typeof refreshProductTruth>[2]) => {
      const existingProtected = state.productTruth
        ? state.assets.filter((a) => state.productTruth!.protectedAssetIds.includes(a.id))
        : [];
      const combined = mergeProductAssets(existingProtected, incoming);
      void refreshProductTruth(dispatch, combined, signals, state.productTruth);
    },
    [dispatch, state.assets, state.productTruth],
  );

  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      const result = await importFiles(Array.from(files));
      if (result.assets.length > 0) {
        dispatch({ type: 'ADD_ASSETS', assets: result.assets });
        establishProductTruthFromImport(result.assets);
      }
      for (const error of result.errors) {
        addToast(error.message, 'error', true);
      }

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = '';
      }
    },
    [dispatch, addToast, establishProductTruthFromImport],
  );

  // --- URL import ---

  const handleImportUrlOpen = useCallback(() => {
    setUrlModalOpen(true);
    setUrlInput('');
  }, []);

  const handleImportUrlSubmit = useCallback(async () => {
    if (!urlInput.trim()) return;

    const url = urlInput.trim();
    const result = await importFromUrl(url);
    if ('asset' in result) {
      dispatch({ type: 'ADD_ASSETS', assets: [result.asset] });
      establishProductTruthFromImport([result.asset]);
      setUrlModalOpen(false);
      setUrlInput('');
    } else if ('assets' in result) {
      // Product page import returned multiple assets
      dispatch({ type: 'ADD_ASSETS', assets: result.assets });
      establishProductTruthFromImport(result.assets, signalsFromProductUrl(url));
      setUrlModalOpen(false);
      setUrlInput('');
      addToast(`Imported ${result.assets.length} product images`, 'success', true);
    } else {
      addToast(result.error.message, 'error', true);
    }
  }, [urlInput, dispatch, addToast, establishProductTruthFromImport]);

  const handleUrlModalClose = useCallback(() => {
    setUrlModalOpen(false);
    setUrlInput('');
  }, []);

  // --- Drag and drop ---

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();

      const files = Array.from<File>(e.dataTransfer.files);
      if (files.length === 0) return;

      const result = await importFiles(files);
      if (result.assets.length > 0) {
        dispatch({ type: 'ADD_ASSETS', assets: result.assets });
        establishProductTruthFromImport(result.assets);
      }
      for (const error of result.errors) {
        addToast(error.message, 'error', true);
      }
    },
    [dispatch, addToast, establishProductTruthFromImport],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  }, []);

  // --- Generate Fresh from empty state ---

  const handleGenerateFresh = useCallback(() => {
    dispatch({ type: 'SET_CREATIVE_ROUTE', route: 'generate_fresh' });
    // Add a placeholder asset so the studio enters the active state
    // Actually, per design: just switch to generation panel view
    // We'll set a flag or just ensure the generation panel is visible
  }, [dispatch]);

  // --- Generation lifecycle (canonical path using assistant context) ---

  const handleGenerate = useCallback(async (overrides?: {
    prompt?: string;
    aspectRatio?: typeof state.aspectRatio;
    outputIntent?: typeof state.outputIntent;
    variationSetId?: string;
    variationIndex?: number;
    carouselSetId?: string;
    carouselSlideIndex?: number;
    carouselSlideTitle?: string;
    openLightbox?: boolean;
    suppressErrorToast?: boolean;
  }) => {
    const { aspectRatio, assets, composerReferences, gallerySelectionIds, activeDocument, productTruth, brandKnowledge, trendResearch, conceptCandidates, selectedConceptId, socialPostDraft, outputIntent } = state;
    const effectivePrompt = overrides?.prompt ?? state.prompt;
    const effectiveReferences = resolveGenerationReferences(composerReferences, gallerySelectionIds);
    const effectiveAspectRatio = overrides?.aspectRatio ?? aspectRatio;
    const effectiveOutputIntent = overrides?.outputIntent ?? outputIntent;

    // Social post drafts carry their own generation brief, so an empty prompt
    // box must not block generating the social post image.
    const hasSocialBrief = effectiveOutputIntent === 'social_post' && !!socialPostDraft?.generationBrief;
    if (!effectivePrompt.trim() && !hasSocialBrief) return;

    // For social posts, update the visible prompt to reflect what's actually being generated
    if (hasSocialBrief && socialPostDraft) {
      const artPlan = socialPostDraft.artDirectionPlan;
      const socialPromptSummary = artPlan
        ? `[Social Post — ${socialPostDraft.platform.replace('_', ' ')}] ${artPlan.visualStrategy}\n\nComposition: ${artPlan.composition}\nText: ${artPlan.textDecision === 'none' ? 'text-free' : artPlan.visibleText.map(v => v.content).join(', ')}`
        : `[Social Post — ${socialPostDraft.platform.replace('_', ' ')}] ${socialPostDraft.generationBrief.slice(0, 300)}`;
      dispatch({ type: 'SET_PROMPT', text: socialPromptSummary });
    }

    dispatch({ type: 'GENERATION_START' });

    try {
      // Build canonical generation request using all assistant context
      const request = buildStudioGenerationRequest({
        prompt: effectivePrompt,
        aspectRatio: effectiveAspectRatio,
        composerReferences: effectiveReferences,
        activeDocument,
        assets,
        productTruth,
        brandKnowledge,
        trendResearch,
        conceptCandidates,
        selectedConceptId,
        socialPostDraft,
        outputIntent: effectiveOutputIntent,
        isPromptEnriched: state.isPromptEnriched,
      });

      // Execute generation
      const result = await executeGeneration(request);

      // Get reference IDs for history
      const referenceIds = effectiveReferences.map(r => r.assetId);
      const variationLabel = overrides?.variationSetId && overrides.variationIndex
        ? ` · V${overrides.variationIndex}`
        : '';
      const generatedName = overrides?.carouselSetId && overrides.carouselSlideIndex
        ? `Slide ${overrides.carouselSlideIndex}${
            overrides.carouselSlideTitle?.trim()
              ? ` · ${overrides.carouselSlideTitle.trim()}`
              : ''
          }`
        : `Generated ${new Date().toLocaleTimeString()}${variationLabel}`;
      // buildStudioGenerationRequest ultimately uses the studio/social-post ratio union,
      // while the shared root request type is intentionally wider (`string`).
      const generatedAspectRatio =
        (request.aspectRatio ?? effectiveAspectRatio) as AspectRatio;

      const newAsset: StudioAsset = {
        id: crypto.randomUUID(),
        name: generatedName,
        description: '',
        base64: result.base64,
        mimeType: result.mimeType,
        width: 0,
        height: 0,
        source: 'generated',
        createdAt: new Date().toISOString(),
        generationPrompt: request.imagePrompt,
        aspectRatio: generatedAspectRatio,
        sourceAssetIds: referenceIds.length > 0 ? referenceIds : undefined,
        variationSetId: overrides?.variationSetId,
        variationIndex: overrides?.variationIndex,
        carouselSetId: overrides?.carouselSetId,
        carouselSlideIndex: overrides?.carouselSlideIndex,
        carouselSlideTitle: overrides?.carouselSlideTitle?.trim() || undefined,
        brandCompliancePending: Boolean(brandKnowledge),
      };

      const historyEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        prompt: request.imagePrompt,
        creativeRoute: 'generate_fresh',
        aspectRatio: generatedAspectRatio,
        referenceAssetIds: referenceIds,
        status: 'success',
        outputAssetId: newAsset.id,
        outputThumbnail: result.base64,
        createdAt: new Date().toISOString(),
      };

      dispatch({ type: 'GENERATION_SUCCESS', asset: newAsset, historyEntry });

      if (brandKnowledge) {
        const complianceReferences = effectiveReferences
          .map((reference) => assets.find((asset) => asset.id === reference.assetId))
          .filter((asset): asset is StudioAsset => Boolean(asset));
        void evaluateBrandCompliance({
          asset: newAsset,
          brandKnowledge,
          productTruth,
          socialPostDraft,
          referenceAssets: complianceReferences,
        }).then((brandCompliance) => {
          dispatch({
            type: 'UPDATE_ASSET',
            id: newAsset.id,
            updates: {
              brandCompliance,
              brandCompliancePending: false,
            },
          });
        });
      }

      // Auto-save to disk in the session folder (fire-and-forget, dev server only)
      void saveAssetToDisk(newAsset);

      // Scroll gallery to top to show new asset
      if (galleryRef.current) {
        galleryRef.current.scrollTo({ top: 0, behavior: 'smooth' });
      }

      if (overrides?.openLightbox !== false) {
        setLightboxAssetId(newAsset.id);
      }

      return newAsset;
    } catch (err: unknown) {
      const errorMessage =
        err instanceof Error ? err.message : 'Generation failed. Please try again.';

      const historyEntry: HistoryEntry = {
        id: crypto.randomUUID(),
        prompt: effectivePrompt,
        creativeRoute: 'generate_fresh',
        aspectRatio: effectiveAspectRatio,
        referenceAssetIds: effectiveReferences.map(r => r.assetId),
        status: 'failure',
        errorMessage,
        createdAt: new Date().toISOString(),
      };

      dispatch({ type: 'GENERATION_FAILURE', error: errorMessage, historyEntry });

      // Persistent toast for generation errors (not auto-dismiss)
      if (!overrides?.suppressErrorToast) {
        addToast(errorMessage, 'error', false);
      }
      return null;
    }
  }, [state, dispatch, addToast]);

  // --- Enhancement lifecycle ---

  const handleEnhance = useCallback(async () => {
    const {
      prompt,
      creativeRoute,
      assets,
      gallerySelectionIds,
      aspectRatio,
      brandKnowledge,
      brandUrlInput,
      productTruth,
      trendResearch,
      composerReferences,
      isPromptEnriched,
      outputIntent,
    } = state;

    if (!prompt.trim()) return;

    dispatch({ type: 'SET_ENHANCING', enhancing: true });

    const lockedRefs = mergeLockedReferences(composerReferences, gallerySelectionIds);
    const selectedAssetIds = Array.from(gallerySelectionIds);
    const baseAsset =
      creativeRoute === 'ai_upgrade' || creativeRoute === 'edit'
        ? assets.find((a) => selectedAssetIds.includes(a.id)) ||
          assets.find((a) => lockedRefs.some((r) => r.assetId === a.id)) ||
          assets[0]
        : undefined;

    const referenceRoles = lockedRefs.map((r) => r.role);
    const referenceImages = lockedRefs
      .map((ref) => {
        const asset = assets.find((a) => a.id === ref.assetId);
        if (!asset?.base64) return null;
        // Skip duplicating the base edit image as a "reference"
        if (baseAsset && asset.id === baseAsset.id) return null;
        return {
          base64: asset.base64,
          mimeType: asset.mimeType,
          role: ref.role,
          label: asset.name || ref.assetId,
        };
      })
      .filter((img): img is NonNullable<typeof img> => Boolean(img))
      // Prefer product locks first; cap vision payload
      .sort((a, b) => {
        const rank = (role?: string) =>
          role === 'product' ? 0 : role === 'style' || role === 'composition' ? 1 : 2;
        return rank(a.role) - rank(b.role);
      })
      .slice(0, 4);

    try {
      // Reuse existing brand research; otherwise fetch website + grounded search.
      let activeBrand = brandKnowledge;
      if (!activeBrand && brandUrlInput.trim()) {
        try {
          const urls = normalizeBrandUrls(brandUrlInput.split('\n'));
          if (urls.length > 0) {
            addToast('Researching brand aesthetics from website…', 'success', true);
            const researched = await researchBrand({ sourceUrls: urls });
            activeBrand = researched.knowledge;
            dispatch({ type: 'SET_BRAND_KNOWLEDGE', brandKnowledge: researched.knowledge });
            if (researched.warnings.length > 0) {
              addToast(researched.warnings[0], 'success', true);
            }
          }
        } catch (err) {
          addToast(
            err instanceof Error
              ? `Brand research skipped: ${err.message}`
              : 'Brand research skipped — enhancing with available context.',
            'error',
            true,
          );
        }
      }

      // If Product Truth is missing but we have locked product images, seed a preliminary truth
      // and kick off full analysis in the background.
      let activeProductTruth = productTruth;
      const lockedProductAssets = lockedRefs
        .filter((r) => r.role === 'product')
        .map((r) => assets.find((a) => a.id === r.assetId))
        .filter((a): a is StudioAsset => Boolean(a));
      if (!activeProductTruth && lockedProductAssets.length > 0) {
        activeProductTruth = buildPreliminaryProductTruth(lockedProductAssets);
        dispatch({ type: 'SET_PRODUCT_TRUTH', productTruth: activeProductTruth });
        void refreshProductTruth(dispatch, lockedProductAssets, undefined, activeProductTruth);
      }

      const brandAestheticsBrief = buildBrandAestheticsBrief(activeBrand);
      const intent = parseStudioEnhanceIntent({
        prompt,
        creativeRoute,
        outputIntent,
        referenceRoles,
      });

      const enhanced = await enhanceStudioPrompt({
        rawPrompt: prompt,
        creativeRoute,
        baseAsset,
        aspectRatio,
        brandName:
          activeBrand?.brandName?.status !== 'rejected'
            ? activeBrand?.brandName?.value
            : undefined,
        productTitle: activeProductTruth?.productName,
        brandPersonality: activeBrand?.toneAttributes
          ?.filter((t) => t.status !== 'rejected')
          .map((t) => t.value)
          .join(', '),
        brandVisualLanguage: activeBrand?.visualPrinciples
          ?.filter((v) => v.status !== 'rejected')
          .map((v) => v.value)
          .join('; '),
        brandAestheticsBrief: brandAestheticsBrief || undefined,
        productFacts: activeProductTruth?.verifiedFacts,
        productPreservationRules: activeProductTruth?.preservationRules,
        trendInsights: trendResearch?.insights?.map((i) => i.title),
        referenceImageCount: lockedRefs.length,
        referenceRoles,
        referenceImages,
        intent: intent.intent,
        intentRationale: intent.rationale,
        intentDirectives: intent.directives,
        isAlreadyEnriched: isPromptEnriched,
      });

      const fullPrompt = enhanced.negativePrompt
        ? `${enhanced.enhancedPrompt}\n\nNEGATIVE PROMPT (things to avoid): ${enhanced.negativePrompt}`
        : enhanced.enhancedPrompt;

      dispatch({ type: 'SET_PROMPT_ENRICHED', text: fullPrompt, enriched: true });
      dispatch({ type: 'SET_ENHANCING', enhancing: false });
    } catch {
      // On failure: retain original prompt, show auto-dismiss toast
      dispatch({ type: 'SET_ENHANCING', enhancing: false });
      addToast('Prompt enhancement failed. Your original prompt is preserved.', 'error', true);
    }
  }, [state, dispatch, addToast]);

  // --- Toolbar handlers ---

  const handleViewModeChange = useCallback(
    (mode: 'default' | 'compact') => {
      dispatch({ type: 'SET_VIEW_MODE', mode });
    },
    [dispatch],
  );

  const handleMultiSelectToggle = useCallback(() => {
    dispatch({ type: 'SET_MULTI_SELECT', enabled: !state.multiSelectEnabled });
  }, [dispatch, state.multiSelectEnabled]);

  const handleClearSelection = useCallback(() => {
    dispatch({ type: 'GALLERY_CLEAR_SELECTION' });
  }, [dispatch]);

  // --- Export handler ---

  const handleExportComplianceModeChange = useCallback((mode: ExportComplianceMode) => {
    setExportComplianceMode(mode);
    writeExportComplianceMode(mode);
  }, []);

  const handleExportSelected = useCallback(() => {
    const { assets, gallerySelectionIds, socialPostDraft, captionPack, brandKnowledge } = state;
    const assetsToExport = gallerySelectionIds.size > 0
      ? assets.filter((a) => gallerySelectionIds.has(a.id))
      : assets;

    if (assetsToExport.length === 0) return;

    const gate = evaluateExportCompliance(assetsToExport, exportComplianceMode);
    if (!gate.canExport) {
      addToast(formatExportComplianceMessage(gate), 'error', false);
      return;
    }

    try {
      const result = downloadStudioExportPack({
        assets: assetsToExport,
        socialPostDraft,
        captionPack,
        brandName: brandKnowledge?.brandName.value,
        brandKnowledge,
        productTruth: state.productTruth,
        clientPack: true,
      });
      addToast(
        `Exported client pack (${result.fileCount} files: masters + captions + rights + report)`,
        'success',
        true,
      );
    } catch (err) {
      // Fallback: download images individually if zip fails
      assetsToExport.forEach((asset, index) => {
        const link = document.createElement('a');
        link.href = `data:${asset.mimeType};base64,${asset.base64}`;
        const ext = asset.mimeType === 'image/png' ? '.png' : asset.mimeType === 'image/webp' ? '.webp' : '.jpg';
        const safeName = (asset.name || `image-${index + 1}`).replace(/[^a-zA-Z0-9_-]/g, '_');
        link.download = `${safeName}${ext}`;
        link.click();
      });
      addToast(
        err instanceof Error ? err.message : `Exported ${assetsToExport.length} image${assetsToExport.length > 1 ? 's' : ''}`,
        err instanceof Error ? 'error' : 'success',
        true,
      );
    }
  }, [state, addToast, exportComplianceMode]);

  const exportAssetsPreview =
    state.gallerySelectionIds.size > 0
      ? state.assets.filter((a) => state.gallerySelectionIds.has(a.id))
      : state.assets;
  const exportBlocked =
    exportComplianceMode === 'strict' &&
    !evaluateExportCompliance(exportAssetsPreview, 'strict').canExport;

  // --- Gallery handlers ---

  const handleToggleSelect = useCallback(
    (id: string) => {
      dispatch({ type: 'GALLERY_TOGGLE_SELECT', id });
    },
    [dispatch],
  );

  const handleTogglePostQueue = useCallback(
    (id: string) => {
      dispatch({ type: 'POST_QUEUE_TOGGLE', id });
    },
    [dispatch],
  );

  const handleClearPostQueue = useCallback(() => {
    dispatch({ type: 'POST_QUEUE_CLEAR' });
  }, [dispatch]);

  const handleReorderPostQueue = useCallback(
    (fromIndex: number, toIndex: number) => {
      dispatch({ type: 'POST_QUEUE_REORDER', fromIndex, toIndex });
    },
    [dispatch],
  );

  const handleOpenDetail = useCallback(
    (id: string) => {
      setLightboxAssetId(id);
    },
    [],
  );

  // --- Generation panel handlers ---

  const handlePromptChange = useCallback(
    (text: string) => {
      dispatch({ type: 'SET_PROMPT', text });
    },
    [dispatch],
  );

  const handleApplyEnrichedPrompt = useCallback(
    (text: string) => {
      dispatch({ type: 'SET_PROMPT_ENRICHED', text, enriched: true });
    },
    [dispatch],
  );

  const handleApplyAndGenerate = useCallback(
    (text: string) => {
      dispatch({ type: 'SET_PROMPT_ENRICHED', text, enriched: true });
      void handleGenerate({ prompt: text });
    },
    [dispatch, handleGenerate],
  );

  const handleGenerateAllSlides = useCallback(
    async (slides: PromptWriterSlide[]) => {
      const validSlides = slides.filter((slide) => slide.prompt.trim());
      if (validSlides.length === 0) return;
      const setId = crypto.randomUUID();
      let lastId: string | null = null;
      let failed = 0;
      batchCancelledRef.current = false;
      setBatchProgress({
        completed: 0,
        total: validSlides.length,
        failed: 0,
        running: true,
      });
      for (let i = 0; i < validSlides.length; i++) {
        if (batchCancelledRef.current) break;
        const slide = validSlides[i];
        const text = slide.negativePrompt
          ? `${slide.prompt}\n\nNEGATIVE PROMPT (things to avoid): ${slide.negativePrompt}`
          : slide.prompt;
        dispatch({ type: 'SET_PROMPT_ENRICHED', text, enriched: true });
        const asset = await handleGenerate({
          prompt: text,
          carouselSetId: setId,
          carouselSlideIndex: slide.slideNumber,
          carouselSlideTitle: slide.title,
          openLightbox: false,
          suppressErrorToast: true,
        });
        if (asset) {
          lastId = asset.id;
        } else {
          failed += 1;
        }
        setBatchProgress({
          completed: i + 1,
          total: validSlides.length,
          failed,
          running: i + 1 < validSlides.length && !batchCancelledRef.current,
        });
      }
      if (lastId) setLightboxAssetId(lastId);
      const succeeded = validSlides.length - failed;
      const wasCancelled = batchCancelledRef.current;
      addToast(
        wasCancelled
          ? `Stopped — ${succeeded} slide${succeeded === 1 ? '' : 's'} generated`
          : failed > 0
            ? `Generated ${succeeded}/${validSlides.length} slides; ${failed} failed`
            : `Generated all ${succeeded} slides`,
        wasCancelled ? 'info' : failed > 0 ? 'error' : 'success',
        true,
      );
    },
    [dispatch, handleGenerate, addToast],
  );

  const handleGenerateBatch = useCallback(
    async (count: number) => {
      const basePrompt = state.prompt.trim();
      if (!basePrompt || count < 1) return;
      const setId = crypto.randomUUID();
      let lastId: string | null = null;
      let failed = 0;
      batchCancelledRef.current = false;
      setBatchProgress({
        completed: 0,
        total: count,
        failed: 0,
        running: true,
      });
      for (let i = 0; i < count; i++) {
        if (batchCancelledRef.current) break;
        const variationHint = buildBatchVariationDirective(i, count);
        const asset = await handleGenerate({
          prompt: `${basePrompt}${variationHint}`,
          variationSetId: count > 1 ? setId : undefined,
          variationIndex: count > 1 ? i + 1 : undefined,
          openLightbox: false,
          suppressErrorToast: true,
        });
        if (asset) {
          lastId = asset.id;
        } else {
          failed += 1;
        }
        setBatchProgress({
          completed: i + 1,
          total: count,
          failed,
          running: i + 1 < count && !batchCancelledRef.current,
        });
      }
      if (lastId) setLightboxAssetId(lastId);
      const succeeded = count - failed;
      const wasCancelled = batchCancelledRef.current;
      addToast(
        wasCancelled
          ? `Stopped — ${succeeded} variation${succeeded === 1 ? '' : 's'} generated`
          : failed > 0
            ? `Generated ${succeeded}/${count} variations; ${failed} failed`
            : `Generated ${succeeded} variation${succeeded === 1 ? '' : 's'}`,
        wasCancelled ? 'info' : failed > 0 ? 'error' : 'success',
        true,
      );
    },
    [state.prompt, handleGenerate, addToast],
  );

  const handleIterate = useCallback(
    (asset: StudioAsset, action: IterateAction) => {
      const base = asset.generationPrompt || state.prompt;
      const next = `${base}\n\nITERATE DIRECTION:\n${ITERATE_PROMPTS[action].instruction}`;
      dispatch({ type: 'SET_PROMPT_ENRICHED', text: next, enriched: true });
      void handleGenerate({ prompt: next });
    },
    [dispatch, handleGenerate, state.prompt],
  );

  const handleAdaptFormat = useCallback(
    async (
      asset: StudioAsset,
      target: AspectRatio,
      opts?: { openLightbox?: boolean; suppressToasts?: boolean },
    ): Promise<StudioAsset | null> => {
      if (!asset.base64) {
        if (!opts?.suppressToasts) {
          addToast('This image has no local data to adapt', 'error', true);
        }
        return null;
      }
      if (asset.aspectRatio === target) {
        if (!opts?.suppressToasts) {
          addToast(`Already ${formatAdaptTargetLabel(target)}`, 'success', true);
        }
        return null;
      }

      dispatch({ type: 'GENERATION_START' });
      dispatch({ type: 'SET_ASPECT_RATIO', ratio: target });

      try {
        const request = buildAdaptFormatRequest(asset, target);
        const result = await executeGeneration(request);
        const label = formatAdaptTargetLabel(target);
        const newAsset: StudioAsset = {
          id: crypto.randomUUID(),
          name: `Adapted ${label} · ${new Date().toLocaleTimeString()}`,
          description: `Reframed from ${asset.aspectRatio || 'source'} to ${target}`,
          base64: result.base64,
          mimeType: result.mimeType,
          width: 0,
          height: 0,
          source: 'generated',
          createdAt: new Date().toISOString(),
          generationPrompt: request.imagePrompt,
          creativeRoute: 'edit',
          aspectRatio: target,
          sourceAssetIds: [asset.id],
          brandCompliancePending: Boolean(state.brandKnowledge),
        };
        const historyEntry: HistoryEntry = {
          id: crypto.randomUUID(),
          prompt: request.imagePrompt,
          creativeRoute: 'edit',
          aspectRatio: target,
          referenceAssetIds: [asset.id],
          status: 'success',
          outputAssetId: newAsset.id,
          outputThumbnail: result.base64,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'GENERATION_SUCCESS', asset: newAsset, historyEntry });
        if (opts?.openLightbox !== false) {
          setLightboxAssetId(newAsset.id);
        }
        if (!opts?.suppressToasts) {
          addToast(`Adapted to ${label}`, 'success', true);
        }

        if (state.brandKnowledge) {
          void evaluateBrandCompliance({
            asset: newAsset,
            brandKnowledge: state.brandKnowledge,
            productTruth: state.productTruth,
            socialPostDraft: state.socialPostDraft,
            referenceAssets: [asset],
          }).then((brandCompliance) => {
            dispatch({
              type: 'UPDATE_ASSET',
              id: newAsset.id,
              updates: {
                brandCompliance,
                brandCompliancePending: false,
              },
            });
          }).catch(() => {
            dispatch({
              type: 'UPDATE_ASSET',
              id: newAsset.id,
              updates: { brandCompliancePending: false },
            });
          });
        }
        return newAsset;
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Adapt format failed';
        const historyEntry: HistoryEntry = {
          id: crypto.randomUUID(),
          prompt: `Adapt to ${target}`,
          creativeRoute: 'edit',
          aspectRatio: target,
          referenceAssetIds: [asset.id],
          status: 'failure',
          errorMessage,
          createdAt: new Date().toISOString(),
        };
        dispatch({ type: 'GENERATION_FAILURE', error: errorMessage, historyEntry });
        if (!opts?.suppressToasts) {
          addToast(errorMessage, 'error', true);
        }
        return null;
      }
    },
    [addToast, dispatch, state.brandKnowledge, state.productTruth, state.socialPostDraft],
  );

  const handleAdaptSelectedFormat = useCallback(
    async (target: AspectRatio) => {
      const selected = state.assets.filter((a) => state.gallerySelectionIds.has(a.id));
      if (selected.length === 0) {
        addToast('Select images first (Select → click thumbnails)', 'error', true);
        return;
      }
      const adaptable = selected.filter((a) => Boolean(a.base64) && a.aspectRatio !== target);
      const skipped = selected.length - adaptable.length;
      if (adaptable.length === 0) {
        addToast(
          skipped > 0
            ? `All ${selected.length} selected image(s) are already ${formatAdaptTargetLabel(target)} (or have no data)`
            : 'Nothing to adapt',
          'success',
          true,
        );
        return;
      }

      const label = formatAdaptTargetLabel(target);
      let lastId: string | null = null;
      let failed = 0;
      setBatchProgress({
        completed: 0,
        total: adaptable.length,
        failed: 0,
        running: true,
      });
      addToast(
        `Adapting ${adaptable.length} image(s) → ${label}${skipped ? ` (${skipped} skipped)` : ''}…`,
        'success',
        true,
      );

      for (let i = 0; i < adaptable.length; i++) {
        const asset = adaptable[i];
        const created = await handleAdaptFormat(asset, target, {
          openLightbox: false,
          suppressToasts: true,
        });
        if (created) {
          lastId = created.id;
        } else {
          failed += 1;
        }
        setBatchProgress({
          completed: i + 1,
          total: adaptable.length,
          failed,
          running: i + 1 < adaptable.length,
        });
      }

      if (lastId) setLightboxAssetId(lastId);
      const succeeded = adaptable.length - failed;
      addToast(
        failed > 0
          ? `Adapted ${succeeded}/${adaptable.length} → ${label}; ${failed} failed`
          : `Adapted ${succeeded} image${succeeded === 1 ? '' : 's'} → ${label}`,
        failed > 0 ? 'error' : 'success',
        true,
      );
    },
    [state.assets, state.gallerySelectionIds, handleAdaptFormat, addToast],
  );

  const handleFixCompliance = useCallback(
    (asset: StudioAsset, check: BrandComplianceCheck) => {
      const base = asset.generationPrompt || state.prompt;
      const correction = [
        base,
        '',
        'BRAND COMPLIANCE CORRECTION:',
        `Issue: ${check.finding}`,
        check.recommendation
          ? `Required correction: ${check.recommendation}`
          : `Improve ${check.label.toLowerCase()} compliance.`,
        'Preserve the core concept and recognizable product identity. Do not introduce unsupported claims.',
      ].join('\n');
      dispatch({
        type: 'SET_PROMPT_ENRICHED',
        text: correction,
        enriched: true,
      });
      void handleGenerate({ prompt: correction });
    },
    [dispatch, handleGenerate, state.prompt],
  );

  const handleRecheckCompliance = useCallback(
    (asset: StudioAsset) => {
      const { brandKnowledge, productTruth, socialPostDraft, assets } = state;
      if (!brandKnowledge) {
        addToast('Research the brand before running compliance', 'error', true);
        return;
      }
      const references = (asset.sourceAssetIds ?? [])
        .map((id) => assets.find((candidate) => candidate.id === id))
        .filter((candidate): candidate is StudioAsset => Boolean(candidate));
      dispatch({
        type: 'UPDATE_ASSET',
        id: asset.id,
        updates: { brandCompliancePending: true },
      });
      void evaluateBrandCompliance({
        asset,
        brandKnowledge,
        productTruth,
        socialPostDraft,
        referenceAssets: references,
      }).then((brandCompliance) => {
        dispatch({
          type: 'UPDATE_ASSET',
          id: asset.id,
          updates: {
            brandCompliance,
            brandCompliancePending: false,
          },
        });
      });
    },
    [state, dispatch, addToast],
  );

  const handleGenerateCaption = useCallback(
    (
      asset: StudioAsset,
      options?: {
        forceWebResearch?: boolean;
        tone?: CaptionTone;
        /** Prefer Instagram post-queue selection order over variation-set order */
        usePostQueue?: boolean;
        reviseInstruction?: string;
      },
    ) => {
      const {
        assets,
        brandKnowledge,
        trendResearch,
        productTruth,
        socialPostDraft,
        conceptCandidates,
        selectedConceptId,
        postQueueIds,
        captionPack,
      } = state;
      const selectedConcept = conceptCandidates.find((concept) => concept.id === selectedConceptId);

      const queueSlides = getPostQueueSlides(assets, postQueueIds);
      const useQueue =
        Boolean(options?.usePostQueue) && queueSlides.length >= 1;

      const carouselSlides = getCaptionCarouselSlides(assets, asset);
      const siblingAssets = useQueue
        ? queueSlides
        : asset.variationSetId && carouselSlides.length >= 2
          ? carouselSlides
          : undefined;
      const postQueueOrdered = Boolean(useQueue && siblingAssets && siblingAssets.length >= 1);
      const groundingAsset =
        useQueue && queueSlides.length > 0
          ? queueSlides.find((s) => s.id === asset.id) || queueSlides[0]
          : asset;

      setIsCaptionGenerating(true);
      setCaptionProgressMessage(
        options?.reviseInstruction?.trim()
          ? 'Revising caption…'
          : siblingAssets && siblingAssets.length >= 2
            ? `Preparing caption for ${siblingAssets.length}-slide set (selection order)…`
            : 'Preparing caption…',
      );

      void generateStudioCaption({
        asset: groundingAsset,
        siblingAssets,
        postQueueOrdered,
        brandKnowledge,
        trendResearch,
        productTruth,
        selectedConcept,
        socialPostDraft,
        forceWebResearch: options?.forceWebResearch,
        tone: options?.tone || captionPack?.tone || 'story',
        previousCaption: captionPack,
        reviseInstruction: options?.reviseInstruction,
        onProgress: (progress) => setCaptionProgressMessage(progress.message),
      })
        .then((nextPack) => {
          dispatch({ type: 'SET_CAPTION_PACK', captionPack: nextPack });
          if (socialPostDraft) {
            dispatch({
              type: 'UPDATE_SOCIAL_POST_DRAFT',
              updates: {
                copy: {
                  ...socialPostDraft.copy,
                  caption: nextPack.caption,
                  hashtags: nextPack.hashtags,
                  callToAction: nextPack.callToAction || socialPostDraft.copy.callToAction,
                },
              },
            });
          }
          const captionDegraded = nextPack.generationStatus === 'fallback';
          const captionFailed = nextPack.generationStatus === 'failed';
          addToast(
            options?.reviseInstruction?.trim()
              ? 'Caption revised — edit or copy anytime'
              : captionFailed
                ? nextPack.generationError || 'Caption generation failed. Retry when ready.'
                : captionDegraded
                ? 'Caption AI failed — brand-safe fallback applied. Tap Regenerate to retry.'
                : nextPack.slideCount && nextPack.slideCount >= 2
                  ? `Caption ready for ${nextPack.slideCount}-slide set — copy or export`
                  : 'Caption ready — copy or export',
            captionDegraded || captionFailed ? 'error' : 'success',
            true,
          );
        })
        .catch((error) => {
          addToast(
            error instanceof Error ? error.message : 'Caption generation failed',
            'error',
            true,
          );
        })
        .finally(() => {
          setIsCaptionGenerating(false);
          setCaptionProgressMessage(null);
        });
    },
    [state, dispatch, addToast],
  );

  const handleGenerateCaptionForQueue = useCallback(
    (opts?: { tone?: CaptionTone; forceWebResearch?: boolean }) => {
      const slides = getPostQueueSlides(state.assets, state.postQueueIds);
      if (slides.length === 0) {
        addToast('Add images to the post queue first', 'error', true);
        return;
      }
      const tone = opts?.tone || 'viral';
      handleGenerateCaption(slides[0], {
        tone,
        // Instagram compose defaults to research-driven hashtags for every tone.
        forceWebResearch: opts?.forceWebResearch ?? true,
        usePostQueue: true,
      });
    },
    [state.assets, state.postQueueIds, handleGenerateCaption, addToast],
  );

  const handleReviseCaptionForQueue = useCallback(
    (instruction: string) => {
      const slides = getPostQueueSlides(state.assets, state.postQueueIds);
      if (slides.length === 0) {
        addToast('Add images to the post queue first', 'error', true);
        return;
      }
      if (!state.captionPack?.caption?.trim()) {
        addToast('Generate a caption before revising', 'error', true);
        return;
      }
      handleGenerateCaption(slides[0], {
        tone: state.captionPack.tone || 'viral',
        forceWebResearch: true,
        usePostQueue: true,
        reviseInstruction: instruction,
      });
    },
    [state.assets, state.postQueueIds, state.captionPack, handleGenerateCaption, addToast],
  );
  const handleExportPostQueue = useCallback(() => {
    const slides = getPostQueueSlides(state.assets, state.postQueueIds);
    if (slides.length === 0) {
      addToast('Post queue is empty', 'error', true);
      return;
    }
    try {
      const result = downloadStudioExportPack({
        assets: slides,
        socialPostDraft: state.socialPostDraft,
        captionPack: state.captionPack,
        brandName: state.brandKnowledge?.brandName.value,
        brandKnowledge: state.brandKnowledge,
        productTruth: state.productTruth,
        clientPack: true,
      });
      addToast(
        `Exported ordered pack (${result.fileCount} files, ${slides.length} slides)`,
        'success',
        true,
      );
    } catch (err) {
      addToast(err instanceof Error ? err.message : 'Export failed', 'error', true);
    }
  }, [state, addToast]);

  const handleCaptionChange = useCallback(
    (updates: Partial<StudioCaptionPack>) => {
      if (!state.captionPack) {
        const seed: StudioCaptionPack = {
          caption: updates.caption || '',
          hashtags: updates.hashtags || [],
          callToAction: updates.callToAction,
          generatedAt: new Date().toISOString(),
          usedWebResearch: false,
          tone: updates.tone || 'viral',
          ...updates,
        };
        dispatch({ type: 'SET_CAPTION_PACK', captionPack: seed });
        return;
      }
      dispatch({ type: 'UPDATE_CAPTION_PACK', updates });
      if (state.socialPostDraft && (updates.caption !== undefined || updates.hashtags || updates.callToAction !== undefined)) {
        dispatch({
          type: 'UPDATE_SOCIAL_POST_DRAFT',
          updates: {
            copy: {
              ...state.socialPostDraft.copy,
              caption: updates.caption ?? state.socialPostDraft.copy.caption,
              hashtags: updates.hashtags ?? state.socialPostDraft.copy.hashtags,
              callToAction:
                updates.callToAction !== undefined
                  ? updates.callToAction
                  : state.socialPostDraft.copy.callToAction,
            },
          },
        });
      }
    },
    [state.captionPack, state.socialPostDraft, dispatch],
  );

  const handleOpenCompare = useCallback((leftId: string, rightId: string) => {
    setComparePair({ leftId, rightId });
  }, []);

  const handleCompareSelected = useCallback(() => {
    const ids = Array.from(state.gallerySelectionIds);
    if (ids.length < 2) return;
    setComparePair({ leftId: ids[0], rightId: ids[1] });
  }, [state.gallerySelectionIds]);

  const handleToggleFavorite = useCallback(
    (assetId: string) => {
      dispatch({ type: 'TOGGLE_VARIATION_FAVORITE', assetId });
    },
    [dispatch],
  );

  const handleKeepFavorites = useCallback(
    (variationSetId: string) => {
      const setAssets = state.assets.filter(
        (asset) => asset.variationSetId === variationSetId,
      );
      const favorites = setAssets.filter((asset) => asset.isFavorite);
      if (favorites.length === 0) {
        addToast('Favorite at least one variation first', 'error', true);
        return;
      }
      setLightboxAssetId(favorites[0].id);
      dispatch({ type: 'KEEP_VARIATION_FAVORITES', variationSetId });
      addToast(
        `Kept ${favorites.length} favorite${favorites.length === 1 ? '' : 's'}`,
        'success',
        true,
      );
    },
    [state.assets, dispatch, addToast],
  );

  const handleDevelopInWriter = useCallback((concept: CreativeConcept) => {
    dispatch({ type: 'SELECT_CONCEPT', conceptId: concept.id });
    const fullPrompt = concept.negativePrompt
      ? `${concept.visualDirection}\n\nNEGATIVE PROMPT (things to avoid): ${concept.negativePrompt}`
      : concept.visualDirection;
    dispatch({ type: 'SET_PROMPT_ENRICHED', text: fullPrompt, enriched: true });
    setPromptWriterSeed(buildConceptWriterSeed(concept, state.strategistBrief));
    setPromptWriterOpenToken((token) => token + 1);
    setShowAssistant(false);
    if (isMobile) setBottomSheetOpen(true);
  }, [dispatch, isMobile, state.strategistBrief]);

  const handleDevelopPromptInWriter = useCallback((prompt: string) => {
    const trimmed = prompt.trim();
    if (!trimmed) return;
    dispatch({ type: 'SET_PROMPT_ENRICHED', text: trimmed, enriched: true });
    setPromptWriterSeed({ instruction: trimmed, slideCount: 1 });
    setPromptWriterOpenToken((token) => token + 1);
    setShowAssistant(false);
    if (isMobile) setBottomSheetOpen(true);
  }, [dispatch, isMobile]);

  const handleRouteChange = useCallback(
    (route: typeof state.creativeRoute) => {
      dispatch({ type: 'SET_CREATIVE_ROUTE', route });
    },
    [dispatch],
  );

  const handleAspectRatioChange = useCallback(
    (ratio: typeof state.aspectRatio) => {
      dispatch({ type: 'SET_ASPECT_RATIO', ratio });
    },
    [dispatch],
  );

  const handleVariationCountChange = useCallback((count: number) => {
    setVariationCount(count);
    setBatchProgress(null);
  }, []);

  const handleOpenRoleAssignment = useCallback(() => {
    if (state.gallerySelectionIds.size < 2) return;

    const draft = new Map<string, RoleAssignment>();
    for (const id of state.gallerySelectionIds) {
      draft.set(
        id,
        seedRoleAssignment(id, state.composerReferences, state.roleAssignments),
      );
    }
    setRoleDraft(draft);
    setRoleAssignmentOpen(true);
  }, [state.gallerySelectionIds, state.composerReferences, state.roleAssignments]);

  const handleUpdateRoleDraft = useCallback((assetId: string, role: ReferenceRole) => {
    setRoleDraft((prev) => {
      const next = new Map<string, RoleAssignment>(prev);
      const existing: RoleAssignment | undefined = next.get(assetId);
      next.set(assetId, {
        role,
        preserve: existing?.preserve,
        modify: existing?.modify,
      });
      return next;
    });
  }, []);

  const handleUpdateRoleInstructionsDraft = useCallback(
    (assetId: string, preserve?: string, modify?: string) => {
      setRoleDraft((prev) => {
        const next = new Map<string, RoleAssignment>(prev);
        const existing: RoleAssignment | undefined = next.get(assetId);
        next.set(assetId, {
          role: existing?.role ?? 'product',
          preserve,
          modify,
        });
        return next;
      });
    },
    [],
  );

  const handleConfirmRoleAssignment = useCallback(() => {
    for (const [assetId, assignment] of roleDraft) {
      const composerRole = referenceRoleToComposer(assignment.role);
      const instructions = roleAssignmentToInstructions(assignment);
      const exists = state.composerReferences.some((r) => r.assetId === assetId);

      if (exists) {
        dispatch({
          type: 'UPDATE_COMPOSER_REFERENCE',
          assetId,
          updates: { role: composerRole, instructions },
        });
      } else {
        dispatch({
          type: 'ADD_COMPOSER_REFERENCE',
          reference: { assetId, role: composerRole, instructions },
        });
      }

      dispatch({ type: 'SET_ROLE', assetId, role: assignment.role });
      dispatch({
        type: 'SET_ROLE_INSTRUCTIONS',
        assetId,
        preserve: assignment.preserve,
        modify: assignment.modify,
      });
    }
    setRoleAssignmentOpen(false);
  }, [roleDraft, state.composerReferences, dispatch]);

  const handleCancelRoleAssignment = useCallback(() => {
    setRoleAssignmentOpen(false);
  }, []);

  // --- Detail panel handlers ---

  const handleDetailClose = useCallback(() => {
    dispatch({ type: 'SET_DETAIL_ASSET', id: null });
  }, [dispatch]);

  const handleDetailDelete = useCallback(
    (id: string) => {
      dispatch({ type: 'REMOVE_ASSET', id });
    },
    [dispatch],
  );

  const handleDetailDownload = useCallback((asset: StudioAsset) => {
    const link = document.createElement('a');
    link.href = `data:${asset.mimeType};base64,${asset.base64}`;
    link.download = asset.name || 'download';
    link.click();
  }, []);

  const handleDetailRegenerate = useCallback(
    (asset: StudioAsset) => {
      if (asset.generationPrompt) {
        dispatch({ type: 'SET_PROMPT_ENRICHED', text: asset.generationPrompt, enriched: true });
      }
      if (asset.creativeRoute) {
        dispatch({ type: 'SET_CREATIVE_ROUTE', route: asset.creativeRoute });
      }
      if (asset.aspectRatio) {
        dispatch({ type: 'SET_ASPECT_RATIO', ratio: asset.aspectRatio });
      }
      dispatch({ type: 'SET_DETAIL_ASSET', id: null });
      if (asset.generationPrompt) {
        void handleGenerate({ prompt: asset.generationPrompt });
      }
    },
    [dispatch, handleGenerate],
  );

  const handleDetailRename = useCallback(
    (id: string, name: string, description?: string) => {
      const updates: Partial<StudioAsset> = { name };
      if (description !== undefined) {
        updates.description = description;
      }
      dispatch({ type: 'UPDATE_ASSET', id, updates });
    },
    [dispatch],
  );

  // --- Derived state ---

  const gallerySelectedAssets = state.assets.filter((a) => state.gallerySelectionIds.has(a.id));
  const selectedAssets = gallerySelectedAssets;
  const lightboxLockedIds = new Set([
    ...state.composerReferences.map((r) => r.assetId),
    ...(state.productTruth?.protectedAssetIds ?? []),
  ]);
  const detailAsset = state.detailAssetId
    ? state.assets.find((a) => a.id === state.detailAssetId) ?? null
    : null;
  const lightboxAssets = lightboxAssetId
    ? getLightboxReviewAssets(state.assets, lightboxAssetId)
    : [];

  // Auto-open bottom sheet on mobile when a detail asset is selected
  useEffect(() => {
    if (isMobile && state.detailAssetId) {
      setBottomSheetOpen(true);
    }
  }, [isMobile, state.detailAssetId]);

  // --- Render ---

  // Step 1: Landing — show the engaging empty state
  if (step === 'landing' && state.assets.length === 0) {
    return (
      <div className="image-studio-root flex flex-col h-full bg-studio-canvas">
        <EmptyState
          onUpload={() => setStep('import')}
          onImportUrl={() => setStep('import')}
          onGenerateFresh={() => {
            handleGenerateFresh();
            setStep('studio');
          }}
        />
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          multiple
          onChange={handleFileChange}
          className="hidden"
          aria-hidden="true"
        />
        {/* Toasts */}
        <ToastContainer toasts={toasts} onDismiss={dismissToast} />
      </div>
    );
  }

  // Step 2: Import — multi-URL + upload + drag-drop collection screen
  if (step === 'import') {
    return (
      <AssetCollectionStep
        assets={state.assets}
        brandUrlInput={state.brandUrlInput}
        onBrandUrlChange={(text) => dispatch({ type: 'SET_BRAND_URL_INPUT', text })}
        onAssetsAdded={(assets) => {
          dispatch({ type: 'ADD_ASSETS', assets });
          establishProductTruthFromImport(assets);
        }}
        onRemoveAsset={(id) => dispatch({ type: 'REMOVE_ASSET', id })}
        onBack={() => {
          if (state.assets.length === 0) {
            setStep('landing');
          } else {
            setStep('landing');
          }
        }}
        onNext={() => setStep('studio')}
      />
    );
  }

  // If we have assets but step is still 'landing', jump to studio
  if (step === 'landing' && state.assets.length > 0) {
    setStep('studio');
  }

  // Step 3: Studio — the full generation workspace

  // Active state: assets loaded
  return (
    <div
      className="image-studio-root flex flex-col h-full bg-studio-canvas"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
    >
      {/* Top chrome */}
      <header className="relative z-40 flex items-center gap-2 px-3 pt-3 pb-1 border-b border-studio-border/40 overflow-visible">
        <button
          type="button"
          onClick={() => setStep('import')}
          className="inline-flex items-center gap-1.5 h-8 px-2.5 rounded-lg text-[11px] font-medium text-studio-mist hover:text-studio-ink hover:bg-white/8 transition-colors focus:outline-none focus:ring-2 focus:ring-studio-accent/40"
          aria-label="Back to import"
        >
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M10.5 19.5L3 12m0 0l7.5-7.5M3 12h18" />
          </svg>
          Import
        </button>
        <div className="hidden sm:block w-px h-5 bg-studio-border/60" aria-hidden="true" />
        <StudioProjectMenu
          state={state}
          onReplaceState={(next) => dispatch({ type: 'REPLACE_STATE', state: next })}
          onToast={(message, type) => addToast(message, type, true)}
        />
        <div className="flex-1 min-w-0 overflow-visible">
          <StudioToolbar
            viewMode={state.viewMode}
            multiSelectEnabled={state.multiSelectEnabled}
            selectedCount={state.gallerySelectionIds.size}
            postQueueCount={state.postQueueIds.length}
            totalAssetCount={state.assets.length}
            onViewModeChange={handleViewModeChange}
            onMultiSelectToggle={handleMultiSelectToggle}
            onClearSelection={handleClearSelection}
            onClearPostQueue={handleClearPostQueue}
            onOpenPostComposer={() => setShowPostComposer(true)}
            onCompareSelected={handleCompareSelected}
            onExportSelected={handleExportSelected}
            onAdaptSelectedFormat={(target) => { void handleAdaptSelectedFormat(target); }}
            isAdaptingSelected={Boolean(batchProgress?.running)}
            exportComplianceMode={exportComplianceMode}
            onExportComplianceModeChange={handleExportComplianceModeChange}
            exportBlocked={exportBlocked}
          />
        </div>
        <button
          type="button"
          onClick={() => setShowTextModel((v) => !v)}
          className="inline-flex items-center h-8 px-2.5 rounded-lg text-[11px] font-medium text-studio-mist hover:text-studio-ink hover:bg-white/8 border border-studio-border/50 transition-colors"
          title="Text model for research / enhance"
        >
          Text · {getPlannerModelOption(textModel).label}
        </button>
        <button
          type="button"
          onClick={() => setShowImageModel((v) => !v)}
          className="inline-flex items-center h-8 px-2.5 rounded-lg text-[11px] font-medium text-studio-mist hover:text-studio-ink hover:bg-white/8 border border-studio-border/50 transition-colors"
          title="Image generation model"
        >
          Image · Nano Banana 2.1
        </button>
      </header>
      {showTextModel && (
        <div className="px-3 pb-3 border-b border-studio-border/40 bg-studio-bg/40">
          <p className="text-[10px] text-studio-mist mb-2">
            Text · Gemini 3.8 Flash
          </p>
          <PlannerModelControls value={textModel} onChange={setTextModel} variant="chips" />
        </div>
      )}
      {showImageModel && (
        <div className="px-3 pb-3 border-b border-studio-border/40 bg-studio-bg/40">
          <p className="text-[10px] text-studio-mist mb-2">
            Image · Nano Banana 2.1
          </p>
          <ImageModelControls variant="chips" />
        </div>
      )}

      {/* Main content area */}
      <div className="flex flex-1 overflow-hidden p-3 gap-3">
        {/* Gallery area */}
        <div
          ref={galleryRef}
          className="flex-1 overflow-y-auto rounded-xl border border-studio-border/50 bg-studio-bg/25"
        >
          <AssetGallery
            assets={state.assets}
            gallerySelectionIds={state.gallerySelectionIds}
            postQueueIds={state.postQueueIds}
            multiSelectEnabled={state.multiSelectEnabled}
            viewMode={state.viewMode}
            detailAssetId={state.detailAssetId}
            onToggleSelect={handleToggleSelect}
            onTogglePostQueue={handleTogglePostQueue}
            onOpenDetail={handleOpenDetail}
          />
        </div>

        {/* Side panel: Generation or Detail (desktop only) */}
        {!isMobile && (
          <div className="w-[22rem] h-full min-h-0 flex-shrink-0 flex flex-col gap-2.5 overflow-hidden">
            {detailAsset ? (
              <div className="min-h-0 flex-1 overflow-y-auto">
                <AssetDetailPanel
                  asset={detailAsset}
                  onClose={handleDetailClose}
                  onDelete={handleDetailDelete}
                  onDownload={handleDetailDownload}
                  onRegenerate={handleDetailRegenerate}
                  onRename={handleDetailRename}
                  onOpenVideoStudio={(asset) => setVideoStudioAssetId(asset.id)}
                />
              </div>
            ) : (
              <>
                {/* Prompt / Writer first — Product Truth must not bury generation controls */}
                <div className="min-h-0 flex-1 overflow-hidden">
                  <GenerationPanel
                    prompt={state.prompt}
                    creativeRoute={state.creativeRoute}
                    aspectRatio={state.aspectRatio}
                    selectedAssets={selectedAssets}
                    allAssets={state.assets}
                    composerReferences={state.composerReferences}
                    isGenerating={state.isGenerating}
                    isEnhancing={state.isEnhancing}
                    brandKnowledge={state.brandKnowledge}
                    productTruth={state.productTruth}
                    trendResearch={state.trendResearch}
                    brandUrlInput={state.brandUrlInput}
                    onBrandUrlChange={(text) => dispatch({ type: 'SET_BRAND_URL_INPUT', text })}
                    promptWriterSeed={promptWriterSeed}
                    promptWriterOpenToken={promptWriterOpenToken}
                    onPromptChange={handlePromptChange}
                    onApplyEnrichedPrompt={handleApplyEnrichedPrompt}
                    onApplyAndGenerate={handleApplyAndGenerate}
                    onGenerateAllSlides={handleGenerateAllSlides}
                    onRouteChange={handleRouteChange}
                    onAspectRatioChange={handleAspectRatioChange}
                    onEnhance={handleEnhance}
                    onGenerate={() => { void handleGenerate(); }}
                    onGenerateBatch={handleGenerateBatch}
                    variationCount={variationCount}
                    onVariationCountChange={handleVariationCountChange}
                    batchProgress={batchProgress}
                    onStopBatch={handleStopBatch}
                    onOpenRoleAssignment={handleOpenRoleAssignment}
                  />
                </div>
                {/* Creative Assistant Toggle */}
                <button
                  type="button"
                  onClick={() => setShowAssistant((open) => !open)}
                  className={`w-full flex-shrink-0 px-3 py-2.5 rounded-xl text-xs font-medium transition-all flex items-center gap-2 border ${
                    showAssistant
                      ? 'bg-studio-accent/20 border-studio-accent/50 text-teal-50 shadow-sm shadow-studio-accent/10'
                      : 'bg-studio-surface border-studio-border text-studio-mist hover:text-studio-ink hover:border-studio-accent/40'
                  }`}
                >
                  <svg className="w-4 h-4 text-studio-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span className="flex-1 text-left">{showAssistant ? 'Close Assistant' : 'Creative Assistant'}</span>
                  {(state.brandKnowledge || state.trendResearch || state.conceptCandidates.length > 0) && (
                    <span className="px-1.5 py-0.5 rounded-md bg-studio-canvas/60 border border-studio-border/60 text-[10px] tabular-nums text-studio-mist">
                      {state.brandKnowledge ? 'Brand' : ''}
                      {state.trendResearch ? `${state.brandKnowledge ? ' · ' : ''}Trends` : ''}
                      {state.conceptCandidates.length > 0
                        ? `${state.brandKnowledge || state.trendResearch ? ' · ' : ''}${state.conceptCandidates.filter((c) => c.status === 'candidate').length} concepts`
                        : ''}
                    </span>
                  )}
                </button>
                {state.productTruth && (
                  <div className="flex-shrink-0 max-h-40 overflow-y-auto">
                    <ProductTruthPanel
                      productTruth={state.productTruth}
                      assets={state.assets}
                      onAddCorrection={(correction) =>
                        dispatch({ type: 'ADD_PRODUCT_TRUTH_CORRECTION', correction })
                      }
                      onRemoveAsset={(id) => {
                        dispatch({ type: 'REMOVE_ASSET', id });
                        const remainingProtected = state.productTruth!.protectedAssetIds.filter(
                          (pid) => pid !== id,
                        );
                        if (remainingProtected.length === 0) {
                          dispatch({ type: 'CLEAR_PRODUCT_TRUTH' });
                          return;
                        }
                        const remainingAssets = state.assets.filter((a) =>
                          remainingProtected.includes(a.id),
                        );
                        void refreshProductTruth(
                          dispatch,
                          remainingAssets,
                          undefined,
                          {
                            ...state.productTruth!,
                            protectedAssetIds: remainingProtected,
                          },
                        );
                      }}
                      onClear={() => dispatch({ type: 'CLEAR_PRODUCT_TRUTH' })}
                    />
                  </div>
                )}
              </>
            )}
          </div>
        )}

        {/* Creative Assistant Panel — Desktop side panel, Mobile sheet */}
        {showAssistant && (
          <>
            {/* Desktop: Right side panel */}
            {!isMobile && (
              <div className="w-[26rem] h-full min-h-0 flex-shrink-0 overflow-hidden rounded-xl border border-studio-border bg-studio-surface shadow-lg shadow-black/25">
                <CreativeAssistantPanel
                  state={state}
                  onDispatch={dispatch}
                  onClose={() => setShowAssistant(false)}
                  onGenerate={handleGenerate}
                  onDevelopInWriter={handleDevelopInWriter}
                  onDevelopPromptInWriter={handleDevelopPromptInWriter}
                />
              </div>
            )}

            {/* Mobile: Bottom sheet */}
            {isMobile && (
              <BottomSheet onClose={() => setShowAssistant(false)}>
                <CreativeAssistantPanel
                  state={state}
                  onDispatch={dispatch}
                  onClose={() => setShowAssistant(false)}
                  onGenerate={handleGenerate}
                  onDevelopInWriter={handleDevelopInWriter}
                  onDevelopPromptInWriter={handleDevelopPromptInWriter}
                />
              </BottomSheet>
            )}
          </>
        )}
      </div>

      {/* Mobile FAB to open bottom sheet */}
      {isMobile && !bottomSheetOpen && (
        <button
          type="button"
          onClick={() => setBottomSheetOpen(true)}
          className="fixed bottom-6 right-6 z-40 min-w-[48px] min-h-[48px] w-12 h-12 rounded-full bg-studio-accent hover:bg-studio-accent-strong text-white shadow-lg flex items-center justify-center transition-colors focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas"
          aria-label="Open generation panel"
        >
          <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
        </button>
      )}

      {/* Mobile bottom sheet */}
      {isMobile && bottomSheetOpen && (
        <BottomSheet onClose={() => setBottomSheetOpen(false)}>
          {detailAsset ? (
            <AssetDetailPanel
              asset={detailAsset}
              onClose={() => {
                handleDetailClose();
                setBottomSheetOpen(false);
              }}
              onDelete={handleDetailDelete}
              onDownload={handleDetailDownload}
              onRegenerate={handleDetailRegenerate}
              onRename={handleDetailRename}
              onOpenVideoStudio={(asset) => {
                setBottomSheetOpen(false);
                setVideoStudioAssetId(asset.id);
              }}
            />
          ) : (
            <>
              <GenerationPanel
                prompt={state.prompt}
                creativeRoute={state.creativeRoute}
                aspectRatio={state.aspectRatio}
                selectedAssets={selectedAssets}
                allAssets={state.assets}
                composerReferences={state.composerReferences}
                isGenerating={state.isGenerating}
                isEnhancing={state.isEnhancing}
                brandKnowledge={state.brandKnowledge}
                productTruth={state.productTruth}
                trendResearch={state.trendResearch}
                brandUrlInput={state.brandUrlInput}
                onBrandUrlChange={(text) => dispatch({ type: 'SET_BRAND_URL_INPUT', text })}
                promptWriterSeed={promptWriterSeed}
                promptWriterOpenToken={promptWriterOpenToken}
                onPromptChange={handlePromptChange}
                onApplyEnrichedPrompt={handleApplyEnrichedPrompt}
                onApplyAndGenerate={handleApplyAndGenerate}
                onGenerateAllSlides={handleGenerateAllSlides}
                onRouteChange={handleRouteChange}
                onAspectRatioChange={handleAspectRatioChange}
                onEnhance={handleEnhance}
                onGenerate={() => { void handleGenerate(); }}
                onGenerateBatch={handleGenerateBatch}
                variationCount={variationCount}
                onVariationCountChange={handleVariationCountChange}
                batchProgress={batchProgress}
                onOpenRoleAssignment={handleOpenRoleAssignment}
              />
              {state.productTruth && (
                <ProductTruthPanel
                  productTruth={state.productTruth}
                  assets={state.assets}
                  onAddCorrection={(correction) =>
                    dispatch({ type: 'ADD_PRODUCT_TRUTH_CORRECTION', correction })
                  }
                  onRemoveAsset={(id) => {
                    dispatch({ type: 'REMOVE_ASSET', id });
                    const remainingProtected = state.productTruth!.protectedAssetIds.filter(
                      (pid) => pid !== id,
                    );
                    if (remainingProtected.length === 0) {
                      dispatch({ type: 'CLEAR_PRODUCT_TRUTH' });
                      return;
                    }
                    const remainingAssets = state.assets.filter((a) =>
                      remainingProtected.includes(a.id),
                    );
                    void refreshProductTruth(
                      dispatch,
                      remainingAssets,
                      undefined,
                      {
                        ...state.productTruth!,
                        protectedAssetIds: remainingProtected,
                      },
                    );
                  }}
                  onClear={() => dispatch({ type: 'CLEAR_PRODUCT_TRUTH' })}
                />
              )}
            </>
          )}
        </BottomSheet>
      )}

      {lightboxAssetId && state.assets.some((asset) => asset.id === lightboxAssetId) && (
        <StudioLightbox
          assets={lightboxAssets}
          referenceAssets={state.assets}
          initialAssetId={lightboxAssetId}
          lockedAssetIds={lightboxLockedIds.size > 0 ? lightboxLockedIds : state.gallerySelectionIds}
          brandName={state.brandKnowledge?.brandName.value}
          isGenerating={state.isGenerating}
          onClose={() => setLightboxAssetId(null)}
          onDownload={handleDetailDownload}
          onCompare={handleOpenCompare}
          onIterate={handleIterate}
          onAdaptFormat={handleAdaptFormat}
          onFixCompliance={handleFixCompliance}
          onRecheckCompliance={handleRecheckCompliance}
          onToggleFavorite={handleToggleFavorite}
          onKeepFavorites={handleKeepFavorites}
          captionPack={state.captionPack}
          isCaptionGenerating={isCaptionGenerating}
          captionProgressMessage={captionProgressMessage}
          onGenerateCaption={handleGenerateCaption}
          onCaptionChange={handleCaptionChange}
          onOpenVideoStudio={(asset) => {
            setLightboxAssetId(null);
            setVideoStudioAssetId(asset.id);
          }}
          onUseAsPrompt={(asset) => {
            if (asset.generationPrompt) {
              dispatch({ type: 'SET_PROMPT_ENRICHED', text: asset.generationPrompt, enriched: true });
              addToast('Prompt loaded into composer', 'success', true);
            }
            setLightboxAssetId(null);
          }}
        />
      )}

      {videoStudioAssetId && (() => {
        const videoAsset = state.assets.find((asset) => asset.id === videoStudioAssetId);
        if (!videoAsset) return null;
        return (
          <VideoStudioPanel
            asset={videoAsset}
            onClose={() => setVideoStudioAssetId(null)}
          />
        );
      })()}

      {showPostComposer && (
        <InstagramPostPanel
          assets={state.assets}
          postQueueIds={state.postQueueIds}
          captionPack={state.captionPack}
          isCaptionGenerating={isCaptionGenerating}
          captionProgressMessage={captionProgressMessage}
          brandName={state.brandKnowledge?.brandName.value}
          onClose={() => setShowPostComposer(false)}
          onReorder={handleReorderPostQueue}
          onRemoveFromQueue={handleTogglePostQueue}
          onClearQueue={handleClearPostQueue}
          onGenerateCaption={handleGenerateCaptionForQueue}
          onReviseCaption={handleReviseCaptionForQueue}
          onCaptionChange={handleCaptionChange}
          onExportOrderedPack={handleExportPostQueue}
          onPublished={(permalink) => {
            addToast(
              permalink ? `Posted to Instagram — ${permalink}` : 'Posted to Instagram',
              'success',
              true,
            );
          }}
          onError={(message) => addToast(message, 'error', true)}
        />
      )}

      {comparePair && (() => {
        const left = state.assets.find((asset) => asset.id === comparePair.leftId);
        const right = state.assets.find((asset) => asset.id === comparePair.rightId);
        if (!left || !right) return null;
        return (
          <StudioCompareView
            left={left}
            right={right}
            onClose={() => setComparePair(null)}
            onSwap={() => setComparePair({ leftId: comparePair.rightId, rightId: comparePair.leftId })}
          />
        );
      })()}

      {/* Hidden file input */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        multiple
        onChange={handleFileChange}
        className="hidden"
        aria-hidden="true"
      />

      {/* Role assignment sheet */}
      {roleAssignmentOpen && selectedAssets.length >= 2 && (
        <RoleAssignmentSheet
          assets={selectedAssets}
          roleAssignments={roleDraft}
          onUpdateRole={handleUpdateRoleDraft}
          onUpdateInstructions={handleUpdateRoleInstructionsDraft}
          onConfirm={handleConfirmRoleAssignment}
          onCancel={handleCancelRoleAssignment}
        />
      )}

      {/* URL Import Modal */}
      {urlModalOpen && (
        <UrlImportModal
          url={urlInput}
          onUrlChange={setUrlInput}
          onSubmit={handleImportUrlSubmit}
          onClose={handleUrlModalClose}
        />
      )}

      {/* Toasts */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

// --- Sub-components ---

/** Bottom Sheet for mobile layout */
interface BottomSheetProps {
  children: React.ReactNode;
  onClose: () => void;
}

const BottomSheet: React.FC<BottomSheetProps> = ({ children, onClose }) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-label="Panel">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-studio-canvas/50"
        onClick={onClose}
        aria-hidden="true"
      />
      {/* Sheet content */}
      <div className="relative bg-studio-surface border-t border-studio-border rounded-t-2xl max-h-[80vh] overflow-y-auto animate-slide-up">
        {/* Drag handle */}
        <div className="flex justify-center pt-3 pb-1">
          <div className="w-10 h-1 rounded-full bg-gray-600" />
        </div>
        {/* Close button */}
        <div className="flex justify-end px-4">
          <button
            type="button"
            onClick={onClose}
            className="min-w-[24px] min-h-[24px] p-1 text-gray-400 hover:text-white rounded transition-colors focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas"
            aria-label="Close panel"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        {/* Panel content */}
        <div className="px-4 pb-6">
          {children}
        </div>
      </div>
    </div>
  );
};

/** URL Import Modal */
interface UrlImportModalProps {
  url: string;
  onUrlChange: (url: string) => void;
  onSubmit: () => void;
  onClose: () => void;
}

const UrlImportModal: React.FC<UrlImportModalProps> = ({ url, onUrlChange, onSubmit, onClose }) => {
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      onSubmit();
    } else if (e.key === 'Escape') {
      onClose();
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-studio-canvas/60"
      role="dialog"
      aria-label="Import from URL"
    >
      <div className="bg-studio-surface border border-studio-border rounded-xl p-6 max-w-md w-full mx-4 shadow-xl">
        <h3 className="text-white font-semibold text-lg mb-4">Import from URL</h3>
        <input
          type="url"
          value={url}
          onChange={(e) => onUrlChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="https://store.com/products/my-product or direct image URL"
          className="w-full px-3 py-2 bg-studio-canvas/30 border border-studio-border rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas focus:border-transparent"
          aria-label="Image URL"
          autoFocus
        />
        <p className="text-xs text-gray-500 mt-2">
          Paste a direct image URL or a product page URL (Shopify, etc.) to import all product images automatically.
        </p>
        <div className="flex gap-3 justify-end mt-5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-[36px] min-w-[24px] px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 focus:ring-offset-studio-canvas"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onSubmit}
            disabled={!url.trim()}
            className="min-h-[36px] min-w-[24px] px-4 py-2 rounded-lg bg-studio-accent hover:bg-studio-accent-strong text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Import
          </button>
        </div>
      </div>
    </div>
  );
};

/** Toast Container */
interface ToastContainerProps {
  toasts: Toast[];
  onDismiss: (id: string) => void;
}

const ToastContainer: React.FC<ToastContainerProps> = ({ toasts, onDismiss }) => {
  if (toasts.length === 0) return null;

  return (
    <div
      className="fixed top-4 right-4 z-50 flex flex-col gap-2 max-w-sm"
      aria-live="polite"
      aria-label="Notifications"
    >
      {toasts.map((toast) => (
        <div
          key={toast.id}
          className={`flex items-start gap-2 px-4 py-3 rounded-lg shadow-lg border ${
            toast.type === 'error'
              ? 'bg-red-900/90 border-red-700 text-red-100'
              : 'bg-green-900/90 border-green-700 text-green-100'
          }`}
          role="alert"
        >
          <span className="flex-1 text-sm">{toast.message}</span>
          {!toast.autoDismiss && (
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              className="min-w-[24px] min-h-[24px] text-current opacity-70 hover:opacity-100 transition-opacity focus:outline-none focus:ring-2 focus:ring-white/50 focus:ring-offset-2 focus:ring-offset-studio-canvas rounded"
              aria-label="Dismiss notification"
            >
              ✕
            </button>
          )}
        </div>
      ))}
    </div>
  );
};

export default AIImageStudioScreen;
