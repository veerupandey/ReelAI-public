/**
 * AgencyImageStudioPanel — Brand Ad Agency Images step using modern studio
 * review tools (gallery, lightbox, compare, compliance, export) while keeping
 * the parent storyboard contract (lockedProduct + excludedAssetIds).
 */

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { Brand, BrandAsset, ProductContext, SceneRoute } from '../../types/brand';
import type { BrandComplianceCheck, BrandComplianceReport, StudioAsset } from './types';
import AssetGallery from './AssetGallery';
import StudioToolbar from './StudioToolbar';
import StudioLightbox, { getLightboxReviewAssets } from './StudioLightbox';
import VideoStudioPanel from './VideoStudioPanel';
import StudioCompareView from './StudioCompareView';
import { downloadStudioExportPack } from './exportPackService';
import { evaluateBrandCompliance } from './brandComplianceService';
import {
  brandAssetsToStudioAssets,
  hydrateStudioAssetBase64,
  seedAgencyStudioContext,
} from './agencyStudioAdapter';
import {
  evaluateExportCompliance,
  formatExportComplianceMessage,
  readExportComplianceMode,
  writeExportComplianceMode,
  type ExportComplianceMode,
} from './exportComplianceGate';
import AgencyCreativeCopilot, { buildAgencyProductionPrompt } from './AgencyCreativeCopilot';
import type { CreativeConcept, SocialPostDraft } from './types';
import PromptWriter, { type PromptWriterSeed } from './PromptWriter';
import { resolveStudioAssetSrc } from './utils';

export interface AgencyImageStudioPanelProps {
  lockedProduct: ProductContext | null;
  brand: Brand | null;
  excludedAssetIds: string[];
  selectedAssetId: string | null;
  setSelectedAssetId: (id: string | null) => void;
  onToggleAssetExcluded: (assetId: string) => void;
  toAssetPreviewUrl: (asset?: BrandAsset) => string | undefined;
  onGenerateImage: (
    prompt: string,
    route: SceneRoute,
    baseAssetId?: string,
    selectedConcept?: CreativeConcept | null,
    referenceAssetIds?: string[],
  ) => void;
  isGenerating: boolean;
  onEnhancePrompt: (rawPrompt: string, route: SceneRoute, baseAssetId?: string) => Promise<string>;
  isEnhancing: boolean;
  onUploadImage: (file: File) => void;
  onBack: () => void;
  onNext: () => void;
  briefText?: string;
  onBrandUpdated?: (brand: Brand) => void;
}

const ROUTE_OPTIONS: { value: SceneRoute; label: string; desc: string }[] = [
  { value: 'use_existing', label: 'Use Existing', desc: 'Use an imported image as-is' },
  { value: 'upgrade_existing', label: 'AI Upgrade', desc: 'Enhance an existing image with AI' },
  { value: 'composite_product', label: 'Composite', desc: 'Place product in a new scene' },
  { value: 'generate_fresh', label: 'Generate Fresh', desc: 'Create a brand new image' },
  { value: 'continue_sequence', label: 'Continue Seq', desc: 'Extend the previous scene visually' },
];

const AgencyImageStudioPanel: React.FC<AgencyImageStudioPanelProps> = ({
  lockedProduct,
  brand,
  excludedAssetIds,
  selectedAssetId,
  setSelectedAssetId,
  onToggleAssetExcluded,
  toAssetPreviewUrl,
  onGenerateImage,
  isGenerating,
  onEnhancePrompt,
  isEnhancing,
  onUploadImage,
  onBack,
  onNext,
  briefText,
  onBrandUpdated,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [viewMode, setViewMode] = useState<'default' | 'compact'>('default');
  const [multiSelectEnabled, setMultiSelectEnabled] = useState(true);
  const [gallerySelectionIds, setGallerySelectionIds] = useState<Set<string>>(new Set());
  const [lightboxAssetId, setLightboxAssetId] = useState<string | null>(null);
  const [videoStudioAssetId, setVideoStudioAssetId] = useState<string | null>(null);
  const [comparePair, setComparePair] = useState<{ leftId: string; rightId: string } | null>(null);
  const [complianceById, setComplianceById] = useState<Record<string, BrandComplianceReport>>({});
  const [pendingComplianceIds, setPendingComplianceIds] = useState<Set<string>>(new Set());
  const [genPrompt, setGenPrompt] = useState('');
  const [genRoute, setGenRoute] = useState<SceneRoute>('composite_product');
  const [genBaseAssetId, setGenBaseAssetId] = useState('');
  const [exporting, setExporting] = useState(false);
  const [exportComplianceMode, setExportComplianceMode] = useState<ExportComplianceMode>(() =>
    readExportComplianceMode(),
  );
  const [selectedConcept, setSelectedConcept] = useState<CreativeConcept | null>(null);
  const [promptPreviewOpen, setPromptPreviewOpen] = useState(false);
  const [socialPostDraft, setSocialPostDraft] = useState<SocialPostDraft | null>(null);
  const [promptWriterSeed, setPromptWriterSeed] = useState<PromptWriterSeed | null>(null);
  const [promptWriterOpenToken, setPromptWriterOpenToken] = useState(0);
  const [showPromptWriter, setShowPromptWriter] = useState(false);

  const brandAssets = lockedProduct?.productAssets ?? [];
  const seeded = useMemo(() => {
    if (!lockedProduct) return null;
    return seedAgencyStudioContext({ brand, lockedProduct });
  }, [brand, lockedProduct]);

  const studioAssets: StudioAsset[] = useMemo(() => {
    const base = seeded?.studioAssets ?? brandAssetsToStudioAssets(brandAssets);
    return base.map((asset) => ({
      ...asset,
      brandCompliance: complianceById[asset.id] ?? asset.brandCompliance,
      brandCompliancePending: pendingComplianceIds.has(asset.id),
    }));
  }, [seeded, brandAssets, complianceById, pendingComplianceIds]);

  const usableStudioAssets = useMemo(
    () => studioAssets.filter((a) => !excludedAssetIds.includes(a.id)),
    [studioAssets, excludedAssetIds],
  );

  const usableCount = usableStudioAssets.length;
  const excludedSet = useMemo(() => new Set(excludedAssetIds), [excludedAssetIds]);

  useEffect(() => {
    if (usableStudioAssets.length === 0) {
      if (genBaseAssetId) setGenBaseAssetId('');
      return;
    }
    if (!genBaseAssetId || !usableStudioAssets.some((a) => a.id === genBaseAssetId)) {
      setGenBaseAssetId(usableStudioAssets[0].id);
    }
  }, [usableStudioAssets, genBaseAssetId]);

  // Keep parent selectedAssetId in sync with gallery selection when single-selecting
  useEffect(() => {
    if (selectedAssetId && !gallerySelectionIds.has(selectedAssetId) && gallerySelectionIds.size === 0) {
      setGallerySelectionIds(new Set([selectedAssetId]));
    }
  }, [selectedAssetId]); // eslint-disable-line react-hooks/exhaustive-deps

  const runCompliance = useCallback(
    async (asset: StudioAsset) => {
      if (!seeded?.brandKnowledge) return;
      setPendingComplianceIds((prev) => new Set(prev).add(asset.id));
      try {
        const report = await evaluateBrandCompliance({
          asset,
          brandKnowledge: seeded.brandKnowledge,
          productTruth: seeded.productTruth,
        });
        setComplianceById((prev) => ({ ...prev, [asset.id]: report }));
      } finally {
        setPendingComplianceIds((prev) => {
          const next = new Set(prev);
          next.delete(asset.id);
          return next;
        });
      }
    },
    [seeded],
  );

  const handleToggleSelect = useCallback(
    (id: string) => {
      setGallerySelectionIds((prev) => {
        const next = new Set(prev);
        if (multiSelectEnabled) {
          if (next.has(id)) next.delete(id);
          else next.add(id);
        } else {
          if (next.has(id) && next.size === 1) next.clear();
          else {
            next.clear();
            next.add(id);
          }
        }
        return next;
      });
      setSelectedAssetId(id);
      if (!excludedAssetIds.includes(id)) {
        setGenBaseAssetId(id);
      }
    },
    [setSelectedAssetId, multiSelectEnabled, excludedAssetIds],
  );

  const handleOpenDetail = useCallback(
    (id: string) => {
      setLightboxAssetId(id);
      setSelectedAssetId(id);
      if (!excludedAssetIds.includes(id)) {
        setGenBaseAssetId(id);
      }
      const asset = studioAssets.find((a) => a.id === id);
      if (asset && !asset.brandCompliance && seeded?.brandKnowledge) {
        void runCompliance(asset);
      }
    },
    [setSelectedAssetId, studioAssets, seeded, runCompliance, excludedAssetIds],
  );

  const handleCompareSelected = useCallback(() => {
    const ids = Array.from(gallerySelectionIds);
    if (ids.length < 2) return;
    setComparePair({ leftId: ids[0], rightId: ids[1] });
  }, [gallerySelectionIds]);

  const handleExport = useCallback(async () => {
    const targets =
      gallerySelectionIds.size > 0
        ? studioAssets.filter((a) => gallerySelectionIds.has(a.id))
        : studioAssets.filter((a) => !excludedAssetIds.includes(a.id));
    if (targets.length === 0) {
      window.alert('No images to export. Select images or restore excluded ones first.');
      return;
    }

    const gate = evaluateExportCompliance(targets, exportComplianceMode);
    if (!gate.canExport) {
      window.alert(formatExportComplianceMessage(gate));
      return;
    }

    setExporting(true);
    try {
      const hydrated = await Promise.all(targets.map((asset) => hydrateStudioAssetBase64(asset)));
      const exportable = hydrated.filter((asset) => asset.base64);
      if (exportable.length === 0) {
        window.alert(
          'Could not download image data for export. Try uploading images or regenerating, then export again.',
        );
        return;
      }
      if (exportable.length < hydrated.length) {
        window.alert(
          `Exported ${exportable.length} of ${hydrated.length} images. Some remote previews could not be downloaded.`,
        );
      }
      await downloadStudioExportPack({
        assets: exportable,
        brandName: brand?.name || lockedProduct?.brandName,
        brandKnowledge: seeded?.brandKnowledge,
        productTruth: seeded?.productTruth,
        socialPostDraft: socialPostDraft ?? undefined,
        clientPack: true,
      });
    } catch (error) {
      window.alert(error instanceof Error ? error.message : 'Export failed.');
    } finally {
      setExporting(false);
    }
  }, [gallerySelectionIds, studioAssets, excludedAssetIds, brand, lockedProduct, exportComplianceMode, seeded, socialPostDraft]);

  const agencyExportTargets =
    gallerySelectionIds.size > 0
      ? studioAssets.filter((a) => gallerySelectionIds.has(a.id))
      : studioAssets.filter((a) => !excludedAssetIds.includes(a.id));
  const agencyExportBlocked =
    exportComplianceMode === 'strict' &&
    !evaluateExportCompliance(agencyExportTargets, 'strict').canExport;

  const handleGenerate = useCallback(() => {
    if (!genPrompt.trim()) return;
    const selectedIds = Array.from(gallerySelectionIds);
    const referenceAssetIds =
      selectedIds.length > 0
        ? selectedIds
        : genBaseAssetId
          ? [genBaseAssetId]
          : [];
    const effectiveBaseId = genBaseAssetId || referenceAssetIds[0] || '';
    if (genRoute !== 'generate_fresh' && !effectiveBaseId) {
      window.alert('Select one or more images in the gallery (or a base image) for this generation route.');
      return;
    }
    onGenerateImage(
      genPrompt,
      genRoute,
      effectiveBaseId || undefined,
      selectedConcept,
      referenceAssetIds,
    );
  }, [genPrompt, genRoute, genBaseAssetId, gallerySelectionIds, onGenerateImage, selectedConcept]);

  const productionPreview = useMemo(() => {
    if (!lockedProduct || !genPrompt.trim()) return '';
    return buildAgencyProductionPrompt({
      userPrompt: genPrompt,
      brand,
      lockedProduct,
      selectedConcept,
    });
  }, [genPrompt, brand, lockedProduct, selectedConcept]);

  const handleEnhance = useCallback(async () => {
    if (!genPrompt.trim()) return;
    const enhanced = await onEnhancePrompt(genPrompt, genRoute, genBaseAssetId || undefined);
    if (enhanced) setGenPrompt(enhanced);
  }, [genPrompt, genRoute, genBaseAssetId, onEnhancePrompt]);

  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) onUploadImage(file);
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onUploadImage],
  );

  // Auto-run compliance on newly generated assets once they appear
  const seenGeneratedRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!seeded?.brandKnowledge) return;
    for (const asset of studioAssets) {
      if (asset.source !== 'generated') continue;
      if (seenGeneratedRef.current.has(asset.id)) continue;
      if (asset.brandCompliance || pendingComplianceIds.has(asset.id)) continue;
      seenGeneratedRef.current.add(asset.id);
      void runCompliance(asset);
    }
  }, [studioAssets, seeded, pendingComplianceIds, runCompliance]);

  if (!lockedProduct) {
    return (
      <div className="space-y-8">
        <div className="text-center mb-8">
          <h2 className="text-3xl font-bold text-white mb-2">Image Studio</h2>
          <p className="text-gray-400">No product imported yet</p>
        </div>
        <div className="max-w-3xl mx-auto">
          <div className="bg-dark-card rounded-2xl border border-dark-border p-12 text-center">
            <p className="text-gray-400">Import a product first to access the image studio.</p>
            <button
              type="button"
              onClick={onBack}
              className="mt-6 px-6 py-3 rounded-xl bg-dark-bg border border-dark-border text-gray-400 hover:text-white transition-colors"
            >
              ← Back to Product Import
            </button>
          </div>
        </div>
      </div>
    );
  }

  const lightboxAssets = lightboxAssetId
    ? getLightboxReviewAssets(studioAssets, lightboxAssetId)
    : [];

  return (
    <div className="space-y-5" data-testid="agency-image-studio-panel">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
            Brand Ad Agency
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Image Studio
          </h2>
          <p className="mt-1 max-w-xl text-sm text-gray-400">
            {lockedProduct.productTitle}
            <span className="mx-2 text-gray-600">·</span>
            <span className="text-gray-300">{usableCount} usable</span>
            {excludedAssetIds.length > 0 && (
              <>
                <span className="mx-2 text-gray-600">·</span>
                <span className="text-gray-500">{excludedAssetIds.length} excluded</span>
              </>
            )}
          </p>
        </div>
        {seeded?.productTruth && (
          <div className="max-w-sm rounded-xl border border-white/[0.06] bg-white/[0.03] px-3.5 py-2.5">
            <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              Product truth
            </p>
            <p className="mt-1 text-xs font-medium text-white line-clamp-1">
              {seeded.productTruth.productName}
            </p>
            <p className="mt-0.5 text-[11px] leading-snug text-gray-500 line-clamp-2">
              {seeded.productTruth.preservationRules[0]}
            </p>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <StudioToolbar
          viewMode={viewMode}
          multiSelectEnabled={multiSelectEnabled}
          selectedCount={gallerySelectionIds.size}
          totalAssetCount={studioAssets.length}
          onViewModeChange={setViewMode}
          onMultiSelectToggle={() =>
            setMultiSelectEnabled((v) => {
              if (v) setGallerySelectionIds(new Set());
              return !v;
            })
          }
          onClearSelection={() => setGallerySelectionIds(new Set())}
          onExportSelected={() => {
            void handleExport();
          }}
          exportComplianceMode={exportComplianceMode}
          onExportComplianceModeChange={(mode) => {
            setExportComplianceMode(mode);
            writeExportComplianceMode(mode);
          }}
          exportBlocked={agencyExportBlocked}
        />
        {gallerySelectionIds.size >= 2 && (
          <button
            type="button"
            onClick={handleCompareSelected}
            className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:bg-white/[0.08]"
          >
            Compare selected
          </button>
        )}
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs font-medium text-gray-200 transition hover:bg-white/[0.08]"
        >
          Upload image
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          className="hidden"
          onChange={handleFileChange}
        />
        {exporting && <span className="text-xs text-gray-400">Exporting…</span>}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-h-[420px] rounded-2xl border border-white/[0.06] bg-black/20 p-3">
          <AssetGallery
            assets={studioAssets}
            gallerySelectionIds={gallerySelectionIds}
            multiSelectEnabled={multiSelectEnabled}
            viewMode={viewMode}
            detailAssetId={selectedAssetId}
            onToggleSelect={handleToggleSelect}
            onOpenDetail={handleOpenDetail}
            excludedIds={excludedSet}
            onToggleExcluded={onToggleAssetExcluded}
            selectionBadgeLabel="Selected"
            emptyMessage={
              brandAssets.length > 0
                ? 'Imported assets have no previewable image data yet. Re-import the product or upload images.'
                : 'No images yet — upload or generate to curate your storyboard set.'
            }
          />
        </div>

        <div className="space-y-4">
        <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent">
          <div className="border-b border-white/[0.06] px-4 py-3.5">
            <h3 className="text-sm font-semibold tracking-tight text-white">Generate</h3>
            <p className="mt-0.5 text-[11px] text-gray-500">Pick a route, then describe the shot</p>
          </div>
          <div className="space-y-4 p-4">
          <div className="flex flex-wrap gap-1.5">
            {ROUTE_OPTIONS.map((route) => (
              <button
                key={route.value}
                type="button"
                onClick={() => setGenRoute(route.value)}
                title={route.desc}
                className={`rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
                  genRoute === route.value
                    ? 'bg-white text-slate-950'
                    : 'bg-white/[0.04] text-gray-400 ring-1 ring-white/10 hover:text-white'
                }`}
              >
                {route.label}
              </button>
            ))}
          </div>
          <p className="text-[11px] leading-relaxed text-gray-500">
            {ROUTE_OPTIONS.find((r) => r.value === genRoute)?.desc}
          </p>

          {genRoute !== 'generate_fresh' && (
            <div>
              <p className="mb-2 text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                Base image
              </p>
              {usableStudioAssets.length === 0 ? (
                <p className="text-[11px] text-amber-200/90">
                  No usable base images. Restore an excluded image or upload one.
                </p>
              ) : (
                <div className="flex gap-2 overflow-x-auto pb-1">
                  {usableStudioAssets.map((asset) => {
                    const previewUrl = resolveStudioAssetSrc(asset) || toAssetPreviewUrl(
                      brandAssets.find((b) => b.id === asset.id),
                    );
                    const isSelected = genBaseAssetId === asset.id;
                    return (
                      <button
                        key={asset.id}
                        type="button"
                        onClick={() => {
                          setGenBaseAssetId(asset.id);
                          setGallerySelectionIds((prev) => {
                            if (prev.has(asset.id)) return prev;
                            const next = new Set(prev);
                            next.add(asset.id);
                            return next;
                          });
                          setSelectedAssetId(asset.id);
                        }}
                        className={`flex-shrink-0 w-14 overflow-hidden rounded-xl transition ${
                          isSelected
                            ? 'ring-2 ring-white ring-offset-2 ring-offset-[#0b0f14]'
                            : 'opacity-55 hover:opacity-90'
                        }`}
                        aria-label={`Use ${asset.name} as base`}
                        aria-pressed={isSelected}
                      >
                        <div className="aspect-square bg-black/40">
                          {previewUrl ? (
                            <img src={previewUrl} className="h-full w-full object-cover" alt="" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center text-[10px] text-gray-500">
                              img
                            </div>
                          )}
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          <textarea
            value={genPrompt}
            onChange={(e) => setGenPrompt(e.target.value)}
            rows={5}
            placeholder="Describe the image to generate…"
            className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-sm leading-relaxed text-white placeholder:text-gray-600 outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
          />

          {productionPreview && (
            <div>
              <button
                type="button"
                onClick={() => setPromptPreviewOpen((v) => !v)}
                className="text-[11px] text-gray-400 transition hover:text-white"
                data-testid="agency-generate-preview-toggle"
              >
                {promptPreviewOpen ? 'Hide' : 'Preview'} AI prompt
              </button>
              {promptPreviewOpen && (
                <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/[0.06] bg-black/30 p-2.5 text-[10px] leading-relaxed text-gray-400 whitespace-pre-wrap">
                  {productionPreview}
                </pre>
              )}
            </div>
          )}

          {gallerySelectionIds.size > 0 && (
            <p className="text-[11px] text-gray-400" data-testid="agency-selection-refs-hint">
              {gallerySelectionIds.size} selected image{gallerySelectionIds.size === 1 ? '' : 's'} will be used as
              {genRoute === 'generate_fresh' ? ' composite references.' : ' generation references.'}
            </p>
          )}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                void handleEnhance();
              }}
              disabled={isEnhancing || !genPrompt.trim()}
              className="flex-1 rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-gray-300 transition hover:border-white/20 hover:text-white disabled:opacity-40"
            >
              {isEnhancing ? 'Enhancing…' : 'Enhance'}
            </button>
            <button
              type="button"
              onClick={handleGenerate}
              disabled={
                isGenerating ||
                !genPrompt.trim() ||
                (genRoute !== 'generate_fresh' && !genBaseAssetId && gallerySelectionIds.size === 0)
              }
              className="flex-1 rounded-xl bg-white py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-gray-100 disabled:opacity-40"
            >
              {isGenerating ? 'Generating…' : 'Generate'}
            </button>
          </div>
          </div>
        </div>

        {lockedProduct && (
          <AgencyCreativeCopilot
            brand={brand}
            lockedProduct={lockedProduct}
            studioAssets={studioAssets}
            gallerySelectionIds={gallerySelectionIds}
            baseAssetId={genBaseAssetId || undefined}
            briefText={briefText}
            selectedConcept={selectedConcept}
            onSelectedConceptChange={setSelectedConcept}
            onApplyConcept={(_concept, prompt) => setGenPrompt(prompt)}
            onBrandUpdated={onBrandUpdated}
            onSocialDraftReady={setSocialPostDraft}
            onDevelopInWriter={(concept) => {
              setPromptWriterSeed({ instruction: concept.visualDirection });
              setPromptWriterOpenToken((t) => t + 1);
              setShowPromptWriter(true);
            }}
          />
        )}
        </div>
      </div>

      {showPromptWriter && lockedProduct && (
        <PromptWriter
          composerReferences={Array.from(gallerySelectionIds).map((assetId) => ({
            assetId,
            role: 'product' as const,
          }))}
          assets={studioAssets}
          aspectRatio="1:1"
          brandKnowledge={seeded?.brandKnowledge ?? undefined}
          productTruth={seeded?.productTruth}
          seed={promptWriterSeed}
          seedToken={promptWriterOpenToken}
          isOpen={showPromptWriter}
          onApplyPrompt={(prompt) => {
            setGenPrompt(prompt);
            setShowPromptWriter(false);
          }}
          onApplyAndGenerate={(prompt) => {
            setGenPrompt(prompt);
            setShowPromptWriter(false);
            const selectedIds = Array.from(gallerySelectionIds);
            const referenceAssetIds =
              selectedIds.length > 0
                ? selectedIds
                : genBaseAssetId
                  ? [genBaseAssetId]
                  : [];
            const effectiveBaseId = genBaseAssetId || referenceAssetIds[0] || undefined;
            onGenerateImage(prompt, genRoute, effectiveBaseId, selectedConcept, referenceAssetIds);
          }}
          onClose={() => setShowPromptWriter(false)}
        />
      )}

      <div className="flex flex-wrap gap-3 border-t border-white/[0.06] pt-4">
        <button
          type="button"
          onClick={onBack}
          className="rounded-xl border border-white/10 px-6 py-3.5 text-sm font-semibold text-gray-400 transition hover:border-white/20 hover:text-white"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={usableCount === 0}
          className="flex-1 rounded-xl bg-white py-3.5 text-sm font-semibold text-slate-950 transition hover:bg-gray-100 disabled:opacity-40"
        >
          Build Storyboard →
        </button>
      </div>

      {lightboxAssetId && studioAssets.some((a) => a.id === lightboxAssetId) && (
        <StudioLightbox
          assets={lightboxAssets}
          referenceAssets={studioAssets}
          initialAssetId={lightboxAssetId}
          lockedAssetIds={gallerySelectionIds}
          brandName={brand?.name || lockedProduct.brandName}
          isGenerating={isGenerating}
          onClose={() => setLightboxAssetId(null)}
          onCompare={(leftId, rightId) => {
            setLightboxAssetId(null);
            setComparePair({ leftId, rightId });
          }}
          onOpenVideoStudio={(asset) => {
            setLightboxAssetId(null);
            setVideoStudioAssetId(asset.id);
          }}
          onRecheckCompliance={(asset) => {
            void runCompliance(asset);
          }}
          onFixCompliance={(asset: StudioAsset, check: BrandComplianceCheck) => {
            const instruction = `BRAND COMPLIANCE CORRECTION: Fix "${check.label}" — ${check.finding}. ${check.recommendation || ''}`.trim();
            setGenPrompt(
              (asset.generationPrompt ? `${asset.generationPrompt}\n\n` : '') + instruction,
            );
            setGenRoute('upgrade_existing');
            setGenBaseAssetId(asset.id);
            setLightboxAssetId(null);
          }}
        />
      )}

      {videoStudioAssetId && (() => {
        const videoAsset = studioAssets.find((a) => a.id === videoStudioAssetId);
        if (!videoAsset) return null;
        return (
          <VideoStudioPanel
            asset={videoAsset}
            onClose={() => setVideoStudioAssetId(null)}
          />
        );
      })()}

      {comparePair && (() => {
        const left = studioAssets.find((a) => a.id === comparePair.leftId);
        const right = studioAssets.find((a) => a.id === comparePair.rightId);
        if (!left || !right) return null;
        return (
          <StudioCompareView
            left={left}
            right={right}
            onClose={() => setComparePair(null)}
            onSwap={() =>
              setComparePair({ leftId: comparePair.rightId, rightId: comparePair.leftId })
            }
          />
        );
      })()}
    </div>
  );
};

export default AgencyImageStudioPanel;
