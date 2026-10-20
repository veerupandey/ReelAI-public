/**
 * AgencyCreativeCopilot — Discover → Concepts for Brand Ad Agency Images step.
 */

import React, { useCallback, useMemo, useState } from 'react';
import type { Brand, ProductContext } from '../../types/brand';
import type { BrandKnowledge, CreativeConcept, ProductTruth, SocialPostDraft, StudioAsset, TrendResearchResult } from './types';
import {
  generateMoreConcepts,
  getCopilotWarnings,
  runCreativeCopilot,
} from './creativeCopilotService';
import { normalizeBrandUrls } from './brandKnowledgeService';
import { persistBrandKnowledge } from '../../services/brandKnowledgeAdapter';
import { seedAgencyStudioContext } from './agencyStudioAdapter';
import { buildCreativeProductionPrompt } from './creativeContextService';
import { createSocialPostDraft } from './socialPostDirectorService';

export interface AgencyCreativeCopilotProps {
  brand: Brand | null;
  lockedProduct: ProductContext;
  studioAssets: StudioAsset[];
  gallerySelectionIds: Set<string>;
  /** Base image from the generate strip — counts as selected when gallery is empty. */
  baseAssetId?: string;
  briefText?: string;
  onApplyConcept: (concept: CreativeConcept, prompt: string) => void;
  onBrandUpdated?: (brand: Brand) => void;
  selectedConcept: CreativeConcept | null;
  onSelectedConceptChange: (concept: CreativeConcept | null) => void;
  onSocialDraftReady?: (draft: SocialPostDraft) => void;
  onDevelopInWriter?: (concept: CreativeConcept) => void;
}

const StepLabel: React.FC<{ n: number; label: string; active?: boolean; done?: boolean }> = ({
  n,
  label,
  active,
  done,
}) => (
  <div className="flex items-center gap-2.5">
    <span
      className={`flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold ${
        done
          ? 'bg-emerald-500/20 text-emerald-300 ring-1 ring-emerald-400/30'
          : active
            ? 'bg-white text-slate-900'
            : 'bg-white/5 text-gray-500 ring-1 ring-white/10'
      }`}
    >
      {done ? '✓' : n}
    </span>
    <span className={`text-xs font-medium ${active || done ? 'text-white' : 'text-gray-500'}`}>
      {label}
    </span>
  </div>
);

const AgencyCreativeCopilot: React.FC<AgencyCreativeCopilotProps> = ({
  brand,
  lockedProduct,
  studioAssets,
  gallerySelectionIds,
  baseAssetId,
  briefText,
  onApplyConcept,
  onBrandUpdated,
  selectedConcept,
  onSelectedConceptChange,
  onSocialDraftReady,
  onDevelopInWriter,
}) => {
  const seeded = useMemo(
    () => seedAgencyStudioContext({ brand, lockedProduct }),
    [brand, lockedProduct],
  );

  const [brandUrls, setBrandUrls] = useState(
    () => brand?.websiteUrl || lockedProduct.productUrl || '',
  );
  const [goal, setGoal] = useState(
    () =>
      (briefText || '').trim() ||
      `Create Instagram campaign creatives for ${lockedProduct.productTitle}`,
  );
  const [stage, setStage] = useState('');
  const [error, setError] = useState('');
  const [running, setRunning] = useState(false);
  const [moreRunning, setMoreRunning] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [warningsOpen, setWarningsOpen] = useState(false);
  const [brandKnowledge, setBrandKnowledge] = useState<BrandKnowledge | null>(
    seeded.brandKnowledge,
  );
  const [productTruth, setProductTruth] = useState<ProductTruth>(seeded.productTruth);
  const [trendResearch, setTrendResearch] = useState<TrendResearchResult | undefined>();
  const [concepts, setConcepts] = useState<CreativeConcept[]>([]);
  const [socialRunning, setSocialRunning] = useState(false);
  const [socialStage, setSocialStage] = useState('');
  const [socialDraft, setSocialDraft] = useState<SocialPostDraft | null>(null);
  const [previewOpen, setPreviewOpen] = useState(false);

  const references = useMemo(() => {
    const ids =
      gallerySelectionIds.size > 0
        ? Array.from(gallerySelectionIds)
        : baseAssetId
          ? [baseAssetId]
          : studioAssets.slice(0, 4).map((a) => a.id);
    return ids.map((assetId) => ({ assetId, role: 'product' as const }));
  }, [gallerySelectionIds, baseAssetId, studioAssets]);

  const selectedImageCount = useMemo(() => {
    if (gallerySelectionIds.size > 0) return gallerySelectionIds.size;
    if (baseAssetId && studioAssets.some((a) => a.id === baseAssetId)) return 1;
    return 0;
  }, [gallerySelectionIds, baseAssetId, studioAssets]);

  const selectedThumbs = useMemo(() => {
    const ids =
      gallerySelectionIds.size > 0
        ? Array.from(gallerySelectionIds)
        : baseAssetId
          ? [baseAssetId]
          : [];
    return ids
      .map((id) => studioAssets.find((a) => a.id === id))
      .filter((a): a is StudioAsset => Boolean(a))
      .slice(0, 4);
  }, [gallerySelectionIds, baseAssetId, studioAssets]);

  const productionPreview = useMemo(() => {
    if (!selectedConcept && !goal.trim()) return '';
    return buildCreativeProductionPrompt({
      userDirection: selectedConcept?.visualDirection || goal,
      brandKnowledge: brandKnowledge ?? undefined,
      productTruth,
      selectedConcept: selectedConcept ?? undefined,
      trendResearch,
    });
  }, [selectedConcept, goal, brandKnowledge, productTruth, trendResearch]);

  const runResearch = useCallback(async () => {
    let urls: string[];
    try {
      urls = normalizeBrandUrls(brandUrls.split('\n'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Enter a valid brand website URL.');
      return;
    }
    if (!goal.trim()) return;

    setRunning(true);
    setError('');
    setWarnings([]);
    setWarningsOpen(false);
    try {
      const result = await runCreativeCopilot(
        {
          brandUrls: urls,
          campaignGoal: goal,
          productName: lockedProduct.productTitle,
          platform: 'instagram_feed',
          references,
          assets: studioAssets,
          aspectRatio: '1:1',
        },
        setStage,
      );
      setBrandKnowledge(result.brand.knowledge);
      setTrendResearch(result.trends.result);
      setConcepts(result.concepts.concepts);
      setProductTruth(seeded.productTruth);
      setWarnings(getCopilotWarnings(result));
      setStage(`Created ${result.concepts.concepts.length} concepts`);

      if (brand?.id) {
        persistBrandKnowledge(brand, result.brand.knowledge);
        onBrandUpdated?.({
          ...brand,
          status: 'ready',
          updatedAt: new Date().toISOString(),
        });
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Copilot research failed.');
    } finally {
      setRunning(false);
    }
  }, [
    brandUrls,
    goal,
    lockedProduct.productTitle,
    references,
    studioAssets,
    seeded.productTruth,
    brand,
    onBrandUpdated,
  ]);

  const requestMoreConcepts = useCallback(async () => {
    const effectiveGoal =
      goal.trim() || concepts[0]?.oneLineIdea || brandKnowledge?.brandName.value || '';
    if (!effectiveGoal) {
      setError('Add a campaign goal to generate more ideas.');
      return;
    }
    setMoreRunning(true);
    setError('');
    try {
      const result = await generateMoreConcepts({
        campaignGoal: effectiveGoal,
        brandKnowledge: brandKnowledge ?? undefined,
        trendResearch,
        productTruth,
        references,
        assets: studioAssets,
        existingConcepts: concepts,
        conceptCount: 3,
        aspectRatio: '1:1',
      });
      if (!result.concepts.length) {
        setError('No new concepts were generated. Try adjusting the campaign goal.');
      } else {
        setConcepts((prev) => [...prev, ...result.concepts]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not generate more concepts.');
    } finally {
      setMoreRunning(false);
    }
  }, [goal, concepts, brandKnowledge, trendResearch, productTruth, references, studioAssets]);

  const selectConcept = useCallback(
    (concept: CreativeConcept) => {
      onSelectedConceptChange(concept);
      const prompt = [
        concept.visualDirection,
        concept.negativePrompt && `Avoid: ${concept.negativePrompt}`,
      ]
        .filter(Boolean)
        .join('\n');
      onApplyConcept(concept, prompt);
    },
    [onApplyConcept, onSelectedConceptChange],
  );

  const createSocial = useCallback(async () => {
    const selectedIds =
      gallerySelectionIds.size > 0
        ? Array.from(gallerySelectionIds)
        : baseAssetId
          ? [baseAssetId]
          : [];
    const heroAssetId = selectedIds[0];
    if (!heroAssetId) {
      setError('Select one or more images in the gallery (or pick a base image) first.');
      return;
    }
    if (!brandKnowledge) {
      setError('Run brand research first, then create the social post.');
      return;
    }
    setSocialRunning(true);
    setSocialStage('Creating social post…');
    setError('');
    try {
      const result = await createSocialPostDraft(
        {
          brandKnowledge,
          productTruth,
          selectedConcept: selectedConcept ?? undefined,
          heroAssetId,
          supportingAssetIds: selectedIds.filter((id) => id !== heroAssetId),
          availableReferences: selectedIds.map((assetId) => ({
            assetId,
            role: 'product' as const,
          })),
          assets: studioAssets,
          platform: 'instagram_feed',
          objective: 'awareness',
          aspectRatio: '4:5',
        },
        (p) => setSocialStage(p.message),
      );
      setSocialDraft(result.draft);
      onSocialDraftReady?.(result.draft);
      setSocialStage('Social post draft ready');
      if (result.draft.copy.caption) {
        onApplyConcept(
          selectedConcept || {
            id: 'social',
            title: 'Social Post',
            oneLineIdea: result.draft.copy.headline || 'Social post',
            visualDirection: result.draft.generationBrief || result.draft.copy.caption,
            brandFitRationale: 'Social post draft',
            productTruthNotes: [],
            suggestedReferenceRoles: [],
            sourceTrendInsightIds: [],
            status: 'selected',
          },
          result.draft.generationBrief || result.draft.copy.caption,
        );
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Social post creation failed.');
    } finally {
      setSocialRunning(false);
    }
  }, [
    gallerySelectionIds,
    baseAssetId,
    studioAssets,
    brandKnowledge,
    productTruth,
    selectedConcept,
    onSocialDraftReady,
    onApplyConcept,
  ]);

  const conceptsDone = concepts.length > 0;

  return (
    <div
      className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent"
      data-testid="agency-creative-copilot"
    >
      <div className="border-b border-white/[0.06] px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold tracking-tight text-white">Creative Assistant</h3>
            <p className="mt-0.5 text-[11px] leading-relaxed text-gray-500">
              Research → concept → social post
            </p>
          </div>
          {(brandKnowledge?.colors?.length ?? 0) > 0 && (
            <div className="flex items-center gap-1 pt-0.5" aria-label="Brand colors">
              {brandKnowledge!.colors.slice(0, 4).map((c, i) => (
                <span
                  key={`${c.value}-${i}`}
                  className="h-3.5 w-3.5 rounded-full ring-1 ring-white/20"
                  style={{ backgroundColor: c.value }}
                  title={c.value}
                />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-5 p-4">
        <section className="space-y-3">
          <StepLabel n={1} label="Research & concepts" active={!conceptsDone} done={conceptsDone} />
          <label className="block space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              Website
            </span>
            <input
              type="url"
              value={brandUrls}
              onChange={(e) => setBrandUrls(e.target.value)}
              placeholder="https://brand.com"
              className="w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-xs text-white placeholder:text-gray-600 outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
            />
          </label>
          <label className="block space-y-1.5">
            <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
              Campaign goal
            </span>
            <textarea
              value={goal}
              onChange={(e) => setGoal(e.target.value)}
              placeholder="What should these creatives achieve?"
              rows={3}
              className="w-full resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-xs leading-relaxed text-white placeholder:text-gray-600 outline-none transition focus:border-white/20 focus:ring-1 focus:ring-white/10"
            />
          </label>
          <button
            type="button"
            onClick={runResearch}
            disabled={running || !brandUrls.trim() || !goal.trim()}
            className="w-full rounded-xl bg-white py-2.5 text-xs font-semibold text-slate-950 transition hover:bg-gray-100 disabled:opacity-35"
          >
            {running ? stage || 'Working…' : 'Research Brand & Market, Create Concepts'}
          </button>
          {stage && !running && (
            <p className="text-[11px] text-emerald-300/90">{stage}</p>
          )}
          {error && (
            <p className="rounded-xl border border-red-500/20 bg-red-500/10 px-3 py-2 text-[11px] text-red-200">
              {error}
            </p>
          )}
          {warnings.length > 0 && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07]">
              <button
                type="button"
                onClick={() => setWarningsOpen((v) => !v)}
                className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] text-amber-200/90"
              >
                <span>{warnings.length} note{warnings.length === 1 ? '' : 's'} from research</span>
                <span className="text-amber-200/60">{warningsOpen ? 'Hide' : 'Show'}</span>
              </button>
              {warningsOpen && (
                <ul className="space-y-1.5 border-t border-amber-500/15 px-3 py-2 text-[11px] text-amber-100/80">
                  {warnings.map((w) => (
                    <li key={w.slice(0, 48)} className="leading-snug">
                      {w}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </section>

        {concepts.length > 0 && (
          <section className="space-y-3">
            <div className="flex items-center justify-between gap-2">
              <StepLabel n={2} label="Choose a concept" active={!selectedConcept} done={Boolean(selectedConcept)} />
              <span className="text-[10px] text-gray-500">{concepts.length}</span>
            </div>
            <div className="max-h-64 space-y-2 overflow-y-auto pr-0.5">
              {concepts.map((concept) => {
                const selected = concept.id === selectedConcept?.id;
                return (
                  <button
                    key={concept.id}
                    type="button"
                    onClick={() => selectConcept(concept)}
                    className={`w-full rounded-xl border p-3 text-left transition ${
                      selected
                        ? 'border-white/25 bg-white/[0.08] shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]'
                        : 'border-white/[0.06] bg-black/20 hover:border-white/12 hover:bg-white/[0.03]'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="text-xs font-semibold text-white">{concept.title}</div>
                      {selected && (
                        <span className="rounded-md bg-white/10 px-1.5 py-0.5 text-[9px] font-medium uppercase tracking-wide text-white/80">
                          Selected
                        </span>
                      )}
                    </div>
                    <div className="mt-1 text-[11px] leading-snug text-gray-400">
                      {concept.oneLineIdea}
                    </div>
                    <div className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-gray-500">
                      {concept.visualDirection}
                    </div>
                  </button>
                );
              })}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={requestMoreConcepts}
                disabled={moreRunning || running}
                className="flex-1 rounded-xl border border-white/10 py-2 text-xs font-medium text-gray-300 transition hover:border-white/20 hover:text-white disabled:opacity-40"
              >
                {moreRunning ? 'Generating…' : 'More ideas'}
              </button>
              {selectedConcept && onDevelopInWriter && (
                <button
                  type="button"
                  onClick={() => onDevelopInWriter(selectedConcept)}
                  className="flex-1 rounded-xl bg-white/10 py-2 text-xs font-semibold text-white transition hover:bg-white/15"
                >
                  Prompt Writer
                </button>
              )}
            </div>
          </section>
        )}

        <section className="space-y-3">
          <StepLabel
            n={3}
            label="Social post"
            active={selectedImageCount > 0}
            done={Boolean(socialDraft)}
          />
          {selectedThumbs.length > 0 ? (
            <div className="flex items-center gap-2" data-testid="agency-social-selection-hint">
              <div className="flex -space-x-2">
                {selectedThumbs.map((asset) => {
                  const src = asset.base64
                    ? `data:${asset.mimeType};base64,${asset.base64}`
                    : asset.previewUrl;
                  return (
                    <div
                      key={asset.id}
                      className="h-9 w-9 overflow-hidden rounded-lg ring-2 ring-[#0b0f14]"
                    >
                      {src ? (
                        <img src={src} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-white/5" />
                      )}
                    </div>
                  );
                })}
              </div>
              <p className="text-[11px] text-gray-400">
                {selectedImageCount} selected
              </p>
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-gray-500">
              Select images in the gallery to build a social post from them.
            </p>
          )}
          <button
            type="button"
            onClick={() => void createSocial()}
            disabled={socialRunning || selectedImageCount === 0 || !brandKnowledge}
            className="w-full rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-xs font-semibold text-white transition hover:bg-white/[0.08] disabled:opacity-35"
          >
            {socialRunning
              ? socialStage || 'Creating…'
              : selectedImageCount > 0
                ? `Create post from ${selectedImageCount} image${selectedImageCount === 1 ? '' : 's'}`
                : 'Create Social Post From Selected Images'}
          </button>
          {!brandKnowledge && selectedImageCount > 0 && (
            <p className="text-[11px] text-amber-200/80">Run research first.</p>
          )}
          {socialDraft && (
            <div className="rounded-xl border border-white/[0.08] bg-black/25 p-3 space-y-1.5">
              {socialDraft.copy.headline && (
                <p className="text-xs font-semibold text-white">{socialDraft.copy.headline}</p>
              )}
              <p className="line-clamp-4 text-[11px] leading-relaxed text-gray-400">
                {socialDraft.copy.caption}
              </p>
            </div>
          )}
        </section>

        {productionPreview && (
          <section className="border-t border-white/[0.06] pt-3">
            <button
              type="button"
              onClick={() => setPreviewOpen((v) => !v)}
              className="text-[11px] text-gray-400 transition hover:text-white"
              data-testid="agency-prompt-preview-toggle"
            >
              {previewOpen ? 'Hide' : 'Preview'} AI prompt
            </button>
            {previewOpen && (
              <pre className="mt-2 max-h-40 overflow-auto rounded-xl border border-white/[0.06] bg-black/30 p-2.5 text-[10px] leading-relaxed text-gray-400 whitespace-pre-wrap">
                {productionPreview}
              </pre>
            )}
          </section>
        )}
      </div>
    </div>
  );
};

export default AgencyCreativeCopilot;

/** Build the production prompt Agency generate should send (shared with preview). */
export function buildAgencyProductionPrompt(input: {
  userPrompt: string;
  brand: Brand | null;
  lockedProduct: ProductContext;
  selectedConcept?: CreativeConcept | null;
  brandKnowledge?: BrandKnowledge | null;
}): string {
  const seeded = seedAgencyStudioContext({
    brand: input.brand,
    lockedProduct: input.lockedProduct,
  });
  return buildCreativeProductionPrompt({
    userDirection: input.userPrompt,
    brandKnowledge: input.brandKnowledge ?? seeded.brandKnowledge ?? undefined,
    productTruth: seeded.productTruth,
    selectedConcept: input.selectedConcept ?? undefined,
  });
}
