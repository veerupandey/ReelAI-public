import React, { useState, useCallback, useMemo, useEffect } from 'react';
import type {
  CampaignPlatform,
  CampaignObjective,
  ExecutionMode,
  BrandAsset,
  ProductContext,
  StoryboardSceneState,
  SceneRoute,
  AdFormat,
  SceneMotionMode,
  PlannerModelPreference,
} from '../types/brand';
import {
  getAdFormatForPlatform,
  getAgencyStoryboardNextState,
  getPreferredPlatformForAdFormat,
  getSceneDisplayAssetId,
  sceneIntendsFreshGeneration,
  sceneNeedsBoundAsset,
} from './productLock/productLockViewUtils';
import PlannerModelControls from './PlannerModelControls';
import { DEFAULT_PLANNER_MODEL } from '../services/llm/types';
import { getPlannerModelOption } from '../services/llm/catalog';

interface Props {
  platform: CampaignPlatform;
  setPlatform: (v: CampaignPlatform) => void;
  adFormat: AdFormat;
  setAdFormat: (v: AdFormat) => void;
  objective: CampaignObjective;
  setObjective: (v: CampaignObjective) => void;
  durationSec: 10 | 15 | 20 | 30 | 45 | 60;
  setDurationSec: (v: 10 | 15 | 20 | 30 | 45 | 60) => void;
  executionMode: ExecutionMode;
  setExecutionMode: (v: ExecutionMode) => void;
  plannerModel?: PlannerModelPreference;
  setPlannerModel?: (v: PlannerModelPreference) => void;
  audience: string;
  setAudience: (v: string) => void;
  callToAction: string;
  setCallToAction: (v: string) => void;
  tone: string;
  setTone: (v: string) => void;
  briefText: string;
  setBriefText: (v: string) => void;
  sceneCount: number;
  scenes: StoryboardSceneState[];
  lockedProduct: ProductContext | null;
  /** Prefer all usable library assets (universe-aware). Falls back to lockedProduct assets. */
  availableAssets?: BrandAsset[];
  excludedAssetIds: string[];
  toAssetPreviewUrl: (asset?: BrandAsset) => string | undefined;
  onGenerateStoryboard: () => void;
  isGeneratingStoryboard: boolean;
  onBack: () => void;
  onNext: () => void;
  onUpdateSceneIdea?: (ideaId: string, updates: Partial<Pick<StoryboardSceneState, 'text' | 'visualDescription' | 'imagePrompt' | 'motionMode' | 'durationSec'>>) => void;
  onUpdateSceneRoute?: (ideaId: string, route: SceneRoute) => void;
  onUpdateSceneMotionMode?: (ideaId: string, motionMode: SceneMotionMode) => void;
  onAssignSceneBaseAsset?: (ideaId: string, assetId: string) => void;
  onRewriteScene?: (ideaId: string) => Promise<void>;
  isRewritingScene?: boolean;
  errorMessage?: string | null;
  onAddScene?: () => void;
  onRemoveScene?: (sceneId: string) => void;
  onMoveScene?: (sceneId: string, direction: 'up' | 'down') => void;
  onBulkGenerateFreshImages?: () => void;
  isBulkGenerating?: boolean;
  bulkGenerateProgress?: { current: number; total: number } | null;
}

const PLATFORM_LABEL: Record<CampaignPlatform, string> = {
  tiktok: 'TikTok',
  instagram_reels: 'IG Reels',
  youtube_shorts: 'YT Shorts',
  instagram_feed: 'IG Feed',
  instagram_carousel: 'IG Carousel',
};

const OBJECTIVE_LABEL: Record<CampaignObjective, string> = {
  awareness: 'Awareness',
  consideration: 'Consideration',
  conversion: 'Conversion',
  ugc_style: 'UGC',
  founder_story: 'Founder',
};

const EXECUTION_META: Record<ExecutionMode, { label: string; desc: string }> = {
  fast: { label: 'Fast', desc: 'Quick draft' },
  balanced: { label: 'Balanced', desc: 'Quality + speed' },
  agency: { label: 'Agency', desc: 'Full research' },
};

const TONE_OPTIONS = [
  { value: 'minimalist', label: 'Minimal' },
  { value: 'high-energy', label: 'High energy' },
  { value: 'cinematic', label: 'Cinematic' },
  { value: 'raw-ugc', label: 'Raw UGC' },
  { value: 'luxury', label: 'Luxury' },
  { value: 'playful', label: 'Playful' },
  { value: 'editorial', label: 'Editorial' },
  { value: 'asmr', label: 'ASMR' },
];

const ROUTE_OPTIONS: { value: SceneRoute; label: string }[] = [
  { value: 'use_existing', label: 'Use existing' },
  { value: 'upgrade_existing', label: 'AI upgrade' },
  { value: 'composite_product', label: 'Composite' },
  { value: 'generate_fresh', label: 'Generate fresh' },
  { value: 'continue_sequence', label: 'Continue seq' },
];

const DURATION_OPTIONS: (10 | 15 | 20 | 30 | 45 | 60)[] = [10, 15, 20, 30, 45, 60];

const FORMAT_OPTIONS: { value: AdFormat; label: string }[] = [
  { value: 'stitched_video', label: 'Video' },
  { value: 'static_image', label: 'Static' },
  { value: 'carousel', label: 'Carousel' },
  { value: 'veo3_video', label: 'AI video' },
];

const MOTION_OPTIONS: { value: SceneMotionMode; label: string }[] = [
  { value: 'still', label: 'Still' },
  { value: 'live_motion', label: 'Live Motion' },
];

const pillClass = (active: boolean) =>
  `rounded-full px-3 py-1.5 text-[11px] font-medium transition ${
    active
      ? 'bg-white text-slate-950'
      : 'bg-white/[0.04] text-gray-400 ring-1 ring-white/10 hover:text-white'
  }`;

const StoryboardScreen: React.FC<Props> = ({
  platform, setPlatform, adFormat, setAdFormat, objective, setObjective,
  durationSec, setDurationSec, executionMode, setExecutionMode,
  plannerModel, setPlannerModel,
  audience, setAudience, callToAction, setCallToAction, tone, setTone,
  briefText, setBriefText, scenes,
  lockedProduct, availableAssets, excludedAssetIds, toAssetPreviewUrl,
  onGenerateStoryboard, isGeneratingStoryboard,
  onBack, onNext, onUpdateSceneIdea, onUpdateSceneRoute, onUpdateSceneMotionMode,
  onAssignSceneBaseAsset, onRewriteScene, isRewritingScene,
  errorMessage, onAddScene, onRemoveScene, onMoveScene,
  onBulkGenerateFreshImages, isBulkGenerating, bulkGenerateProgress,
}) => {
  const [selectedSceneIndex, setSelectedSceneIndex] = useState<number | null>(null);
  const [imagePickerForSceneId, setImagePickerForSceneId] = useState<string | null>(null);
  const [moreOpen, setMoreOpen] = useState(
    () => Boolean(audience.trim() || callToAction.trim() || tone.trim()),
  );

  const usableAssets = useMemo(() => {
    const source = availableAssets?.length
      ? availableAssets
      : (lockedProduct?.productAssets || []);
    return source.filter((asset) => !excludedAssetIds.includes(asset.id));
  }, [availableAssets, lockedProduct, excludedAssetIds]);

  const findAssetById = useCallback(
    (assetId?: string) => (assetId ? usableAssets.find((asset) => asset.id === assetId) : undefined),
    [usableAssets],
  );

  const selectedScene = selectedSceneIndex !== null ? scenes[selectedSceneIndex] : null;
  const showDuration = adFormat === 'stitched_video' || adFormat === 'veo3_video';

  const freshSceneCount = useMemo(
    () => adFormat === 'carousel'
      ? scenes.filter((s) => !s.linkedAssetId).length
      : scenes.filter((s) =>
        !s.baseAssetId && !s.linkedAssetId && !s.selectedVariantAssetId
        && (s.route === 'generate_fresh' || s.visualTask === 'generate_new'),
      ).length,
    [scenes, adFormat],
  );

  const nextState = useMemo(
    () => getAgencyStoryboardNextState(briefText, scenes, adFormat),
    [briefText, scenes, adFormat],
  );

  const assetUsageMap = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const scene of scenes) {
      const displayId = getSceneDisplayAssetId(scene);
      if (displayId) {
        const list = map.get(displayId) || [];
        list.push(scene.id);
        map.set(displayId, list);
      }
    }
    return map;
  }, [scenes]);

  useEffect(() => {
    if (scenes.length === 0) {
      setSelectedSceneIndex(null);
      setImagePickerForSceneId(null);
      return;
    }
    if (selectedSceneIndex === null || selectedSceneIndex >= scenes.length) {
      setSelectedSceneIndex(0);
    }
  }, [scenes, selectedSceneIndex]);

  const handlePlatformChange = useCallback((nextPlatform: CampaignPlatform) => {
    setPlatform(nextPlatform);
    setAdFormat(getAdFormatForPlatform(nextPlatform));
  }, [setAdFormat, setPlatform]);

  const handleAdFormatChange = useCallback((nextFormat: AdFormat) => {
    setAdFormat(nextFormat);
    setPlatform(getPreferredPlatformForAdFormat(nextFormat, platform));
  }, [platform, setAdFormat, setPlatform]);

  const handleRewrite = useCallback(async () => {
    if (!selectedScene || !onRewriteScene) return;
    await onRewriteScene(selectedScene.id);
  }, [selectedScene, onRewriteScene]);

  const handleAssignImage = useCallback((sceneId: string, assetId: string) => {
    if (onAssignSceneBaseAsset) {
      onAssignSceneBaseAsset(sceneId, assetId);
    }
    setImagePickerForSceneId(null);
  }, [onAssignSceneBaseAsset]);

  const handleUnassignImage = useCallback((sceneId: string) => {
    if (onAssignSceneBaseAsset) {
      onAssignSceneBaseAsset(sceneId, '');
    }
  }, [onAssignSceneBaseAsset]);

  const nextLabel = adFormat === 'carousel' ? 'Review Carousel →' : 'Generate Ad →';

  return (
    <div className="space-y-5" data-testid="storyboard-screen">
      <div className="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-gray-500">
            Brand Ad Agency
          </p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight text-white sm:text-3xl">
            Storyboard
          </h2>
          <p className="mt-1 text-sm text-gray-400">
            {lockedProduct?.productTitle || 'Campaign'}
            <span className="mx-2 text-gray-600">·</span>
            {scenes.length > 0 ? `${scenes.length} scene${scenes.length === 1 ? '' : 's'}` : 'No scenes yet'}
          </p>
        </div>
      </div>

      {errorMessage && (
        <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
          <p className="text-xs font-medium text-red-200">Couldn’t finish storyboard</p>
          <p className="mt-1 text-[11px] text-red-300/80">{errorMessage}</p>
        </div>
      )}

      <div className="grid grid-cols-1 items-start gap-4 xl:grid-cols-12">
        {/* Settings */}
        <div className="xl:col-span-3">
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent">
            <div className="border-b border-white/[0.06] px-4 py-3.5">
              <h3 className="text-sm font-semibold tracking-tight text-white">Campaign</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">Platform, format, and mode</p>
            </div>
            <div className="space-y-4 p-4">
              <div className="space-y-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                  Platform
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(PLATFORM_LABEL) as CampaignPlatform[]).map((p) => (
                    <button
                      key={p}
                      type="button"
                      onClick={() => handlePlatformChange(p)}
                      className={pillClass(platform === p)}
                    >
                      {PLATFORM_LABEL[p]}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                  Format
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {FORMAT_OPTIONS.map((f) => (
                    <button
                      key={f.value}
                      type="button"
                      onClick={() => handleAdFormatChange(f.value)}
                      className={pillClass(adFormat === f.value)}
                    >
                      {f.label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                  Objective
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(OBJECTIVE_LABEL) as CampaignObjective[]).map((o) => (
                    <button
                      key={o}
                      type="button"
                      onClick={() => setObjective(o)}
                      className={pillClass(objective === o)}
                    >
                      {OBJECTIVE_LABEL[o]}
                    </button>
                  ))}
                </div>
              </div>

              {showDuration && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                      Duration
                    </span>
                    <span className="text-[10px] text-gray-500">
                      {scenes.length > 0 ? `${scenes.length} scenes` : `~${Math.ceil(durationSec / 5)} scenes`}
                    </span>
                  </div>
                  <div className="flex flex-wrap gap-1.5">
                    {DURATION_OPTIONS.map((s) => (
                      <button
                        key={s}
                        type="button"
                        onClick={() => setDurationSec(s)}
                        className={pillClass(durationSec === s)}
                      >
                        {s}s
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="space-y-2">
                <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                  Mode
                </span>
                <div className="flex flex-wrap gap-1.5">
                  {(Object.keys(EXECUTION_META) as ExecutionMode[]).map((m) => (
                    <button
                      key={m}
                      type="button"
                      onClick={() => setExecutionMode(m)}
                      title={EXECUTION_META[m].desc}
                      className={pillClass(executionMode === m)}
                    >
                      {EXECUTION_META[m].label}
                    </button>
                  ))}
                </div>
                <p className="text-[11px] text-gray-500">{EXECUTION_META[executionMode].desc}</p>
              </div>

              {setPlannerModel && (
                <div className="space-y-2">
                  <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                    Planner / Agent model
                  </span>
                  <PlannerModelControls
                    value={plannerModel || DEFAULT_PLANNER_MODEL}
                    onChange={setPlannerModel}
                    variant="chips"
                  />
                  <p className="text-[11px] text-gray-500">
                    {getPlannerModelOption(plannerModel || DEFAULT_PLANNER_MODEL).description}. Fallback is always Gemini. Images stay on Gemini Flash Image.
                  </p>
                </div>
              )}

              <div className="border-t border-white/[0.06] pt-3">
                <button
                  type="button"
                  onClick={() => setMoreOpen((v) => !v)}
                  className="flex w-full items-center justify-between text-[11px] text-gray-400 transition hover:text-white"
                >
                  <span>Audience, CTA, tone</span>
                  <span>{moreOpen ? 'Hide' : 'Show'}</span>
                </button>
                {moreOpen && (
                  <div className="mt-3 space-y-3">
                    <div className="space-y-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Tone
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {TONE_OPTIONS.map((t) => (
                          <button
                            key={t.value}
                            type="button"
                            onClick={() => setTone(tone === t.value ? '' : t.value)}
                            className={pillClass(tone === t.value)}
                          >
                            {t.label}
                          </button>
                        ))}
                      </div>
                    </div>
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Audience
                      </span>
                      <input
                        value={audience}
                        onChange={(e) => setAudience(e.target.value)}
                        placeholder="e.g. women 25–40"
                        className="w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-xs text-white placeholder:text-gray-600 outline-none transition focus:border-white/20"
                      />
                    </label>
                    <label className="block space-y-1.5">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Call to action
                      </span>
                      <input
                        value={callToAction}
                        onChange={(e) => setCallToAction(e.target.value)}
                        placeholder="e.g. Shop now"
                        className="w-full rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2.5 text-xs text-white placeholder:text-gray-600 outline-none transition focus:border-white/20"
                      />
                    </label>
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>

        {/* Brief + timeline */}
        <div className="space-y-4 xl:col-span-5">
          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent">
            <div className="border-b border-white/[0.06] px-4 py-3.5">
              <h3 className="text-sm font-semibold tracking-tight text-white">Brief</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">
                Direction for AI storyboard planning
              </p>
            </div>
            <textarea
              value={briefText}
              onChange={(e) => setBriefText(e.target.value)}
              placeholder="Describe the ad creative direction, key messages, and requirements…"
              className="min-h-[140px] w-full resize-none bg-transparent px-4 py-4 text-sm leading-relaxed text-white placeholder:text-gray-600 outline-none"
            />
          </div>

          <div className="overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent">
            <div className="flex items-center justify-between gap-3 border-b border-white/[0.06] px-4 py-3.5">
              <div>
                <h3 className="text-sm font-semibold tracking-tight text-white">Scenes</h3>
                <p className="mt-0.5 text-[11px] text-gray-500">
                  {scenes.length > 0
                    ? `${scenes.length} planned · ${PLATFORM_LABEL[platform]}`
                    : 'Write a brief, then generate or add scenes'}
                </p>
              </div>
            </div>

            <div className="p-4">
              {scenes.length > 0 ? (
                <div className="max-h-[560px] space-y-2 overflow-y-auto pr-0.5">
                  {scenes.map((scene, index) => {
                    const displayAssetId = getSceneDisplayAssetId(scene);
                    const assignedAsset = findAssetById(displayAssetId);
                    const assignedPreview = toAssetPreviewUrl(assignedAsset);
                    const isSelected = selectedSceneIndex === index;
                    const isPickerOpen = imagePickerForSceneId === scene.id;
                    const needsAsset = sceneNeedsBoundAsset(scene);
                    const willGenerate = !displayAssetId && sceneIntendsFreshGeneration(scene);

                    return (
                      <div key={scene.id} className="relative">
                        <div
                          role="button"
                          tabIndex={0}
                          onClick={() => setSelectedSceneIndex(index)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              setSelectedSceneIndex(index);
                            }
                          }}
                          className={`cursor-pointer rounded-xl border p-3 transition ${
                            isSelected
                              ? 'border-white/25 bg-white/[0.08]'
                              : 'border-white/[0.06] bg-black/20 hover:border-white/12'
                          }`}
                        >
                          <div className="flex items-start gap-3">
                            <div className="flex flex-shrink-0 flex-col items-center gap-1.5">
                              <span className="flex h-7 w-7 items-center justify-center rounded-lg bg-white/10 text-[11px] font-semibold text-white">
                                {index + 1}
                              </span>
                              <button
                                type="button"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setImagePickerForSceneId(isPickerOpen ? null : scene.id);
                                  setSelectedSceneIndex(index);
                                }}
                                className={`flex h-12 w-12 items-center justify-center overflow-hidden rounded-lg border border-dashed transition ${
                                  assignedPreview
                                    ? 'border-white/30'
                                    : needsAsset
                                      ? 'border-amber-400/50'
                                      : 'border-white/15 hover:border-white/30'
                                }`}
                                title={assignedAsset ? `Assigned: ${assignedAsset.description || 'Image'}. Click to change.` : 'Click to assign an image'}
                              >
                                {assignedPreview ? (
                                  <img src={assignedPreview} className="h-full w-full object-cover" alt="" />
                                ) : (
                                  <span className="text-gray-500 text-sm">+</span>
                                )}
                              </button>
                              {assignedAsset && (
                                <button
                                  type="button"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    handleUnassignImage(scene.id);
                                  }}
                                  className="text-[9px] text-gray-500 hover:text-red-300"
                                >
                                  Clear
                                </button>
                              )}
                            </div>

                            <div className="min-w-0 flex-1">
                              <div className="flex items-start justify-between gap-2">
                                <div className="min-w-0 flex-1">
                                  <p className="text-sm font-medium text-white">
                                    {scene.text || 'Untitled scene'}
                                  </p>
                                  <p className="mt-1 line-clamp-2 text-[11px] leading-snug text-gray-400">
                                    {scene.visualDescription}
                                  </p>
                                </div>
                                {onMoveScene && onRemoveScene && (
                                  <div className="flex flex-shrink-0 flex-col gap-0.5">
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onMoveScene(scene.id, 'up'); }}
                                      disabled={index === 0}
                                      className="px-1 text-[10px] text-gray-500 hover:text-white disabled:opacity-20"
                                      title="Move up"
                                    >
                                      ▲
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onRemoveScene(scene.id); }}
                                      className="px-1 text-[10px] text-gray-500 hover:text-red-300"
                                      title="Remove scene"
                                    >
                                      ×
                                    </button>
                                    <button
                                      type="button"
                                      onClick={(e) => { e.stopPropagation(); onMoveScene(scene.id, 'down'); }}
                                      disabled={index === scenes.length - 1}
                                      className="px-1 text-[10px] text-gray-500 hover:text-white disabled:opacity-20"
                                      title="Move down"
                                    >
                                      ▼
                                    </button>
                                  </div>
                                )}
                              </div>
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {scene.route && (
                                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-gray-300">
                                    {scene.route.replace(/_/g, ' ')}
                                  </span>
                                )}
                                {scene.durationSec ? (
                                  <span className="rounded-md bg-white/[0.06] px-1.5 py-0.5 text-[10px] text-gray-300">
                                    {scene.durationSec}s
                                  </span>
                                ) : null}
                                {(scene.motionMode || 'still') === 'live_motion' && (
                                  <span className="rounded-md bg-cyan-500/15 px-1.5 py-0.5 text-[10px] text-cyan-200">
                                    Live Motion
                                  </span>
                                )}
                                {!assignedAsset && willGenerate && (
                                  <span className="rounded-md bg-emerald-500/10 px-1.5 py-0.5 text-[10px] text-emerald-200">
                                    Will generate
                                  </span>
                                )}
                                {!assignedAsset && needsAsset && (
                                  <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                                    Needs image
                                  </span>
                                )}
                                {adFormat === 'carousel' && !scene.linkedAssetId && (
                                  <span className="rounded-md bg-amber-500/10 px-1.5 py-0.5 text-[10px] text-amber-200">
                                    Slide pending
                                  </span>
                                )}
                              </div>
                            </div>
                          </div>
                        </div>

                        {isPickerOpen && (
                          <div className="absolute left-0 right-0 z-20 mt-2 rounded-xl border border-white/15 bg-[#12161c] p-3 shadow-2xl shadow-black/50">
                            <div className="mb-2 flex items-center justify-between">
                              <p className="text-xs font-semibold text-white">
                                Assign image · Scene {index + 1}
                              </p>
                              <button
                                type="button"
                                onClick={() => setImagePickerForSceneId(null)}
                                className="text-[11px] text-gray-400 hover:text-white"
                              >
                                Close
                              </button>
                            </div>
                            {usableAssets.length > 0 ? (
                              <div className="grid max-h-48 grid-cols-5 gap-2 overflow-y-auto">
                                {usableAssets.map((asset) => {
                                  const previewUrl = toAssetPreviewUrl(asset);
                                  const isCurrentlyAssigned = displayAssetId === asset.id;
                                  const usedByScenes = assetUsageMap.get(asset.id) || [];
                                  const isUsedElsewhere = usedByScenes.length > 0 && !isCurrentlyAssigned;
                                  return (
                                    <button
                                      key={asset.id}
                                      type="button"
                                      onClick={() => handleAssignImage(scene.id, asset.id)}
                                      className={`relative aspect-square overflow-hidden rounded-lg transition ${
                                        isCurrentlyAssigned
                                          ? 'ring-2 ring-white'
                                          : 'ring-1 ring-white/10 hover:ring-white/30'
                                      }`}
                                      title={asset.semanticDescription || asset.description || 'Image'}
                                    >
                                      {previewUrl ? (
                                        <img src={previewUrl} className="h-full w-full object-cover" alt="" />
                                      ) : (
                                        <div className="flex h-full w-full items-center justify-center bg-black/40 text-[10px] text-gray-500">
                                          No preview
                                        </div>
                                      )}
                                      {isUsedElsewhere && (
                                        <span className="absolute bottom-0.5 right-0.5 rounded bg-black/70 px-1 py-0.5 text-[8px] text-amber-200">
                                          Used
                                        </span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            ) : (
                              <p className="py-4 text-center text-xs text-gray-500">
                                No images available. Upload or generate images in Image Studio first.
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="rounded-xl border border-dashed border-white/10 px-4 py-10 text-center">
                  <p className="text-sm text-gray-300">No scenes yet</p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Generate with AI, or add the first scene manually.
                  </p>
                  {onAddScene && (
                    <button
                      type="button"
                      onClick={onAddScene}
                      className="mt-4 rounded-xl border border-white/10 px-4 py-2 text-sm font-medium text-gray-300 transition hover:border-white/20 hover:text-white"
                    >
                      + Add Scene manually
                    </button>
                  )}
                </div>
              )}

              {onAddScene && scenes.length > 0 && (
                <button
                  type="button"
                  onClick={onAddScene}
                  className="mt-3 w-full rounded-xl border border-dashed border-white/10 py-2.5 text-sm font-medium text-gray-400 transition hover:border-white/20 hover:text-white"
                >
                  + Add Scene
                </button>
              )}

              {onBulkGenerateFreshImages && freshSceneCount > 0 && (
                <button
                  type="button"
                  onClick={onBulkGenerateFreshImages}
                  disabled={isBulkGenerating}
                  className="mt-3 flex w-full items-center justify-center gap-2 rounded-xl border border-white/10 bg-white/[0.04] py-2.5 text-sm font-semibold text-white transition hover:bg-white/[0.08] disabled:opacity-50"
                >
                  {isBulkGenerating ? (
                    <>
                      <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
                      {bulkGenerateProgress
                        ? `Generating ${bulkGenerateProgress.current}/${bulkGenerateProgress.total}…`
                        : 'Generating…'}
                    </>
                  ) : (
                    <>
                      {adFormat === 'carousel'
                        ? `Generate ${freshSceneCount} carousel slide${freshSceneCount === 1 ? '' : 's'}`
                        : `Generate ${freshSceneCount} fresh image${freshSceneCount === 1 ? '' : 's'}`}
                    </>
                  )}
                </button>
              )}
            </div>
          </div>

          {(nextState.blockers.length > 0 || nextState.warnings.length > 0) && (
            <div className="rounded-xl border border-amber-500/20 bg-amber-500/[0.07] px-4 py-3 space-y-1.5">
              <p className="text-[10px] font-medium uppercase tracking-[0.14em] text-amber-200/80">
                Storyboard readiness
              </p>
              {nextState.blockers.map((blocker) => (
                <p key={blocker} className="text-xs text-amber-100">
                  {blocker}
                </p>
              ))}
              {nextState.warnings.slice(0, 4).map((warning) => (
                <p key={`${warning.type}-${warning.message}`} className="text-xs text-amber-200/85">
                  {warning.message}
                </p>
              ))}
            </div>
          )}

          <div className="space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={onBack}
                className="rounded-xl border border-white/10 px-5 py-3 text-sm font-semibold text-gray-400 transition hover:border-white/20 hover:text-white"
              >
                ← Back
              </button>
              <button
                type="button"
                onClick={onGenerateStoryboard}
                disabled={isGeneratingStoryboard || !briefText.trim() || !lockedProduct}
                className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-white py-3 text-sm font-semibold text-slate-950 transition hover:bg-gray-100 disabled:opacity-40"
              >
                {isGeneratingStoryboard && (
                  <span className="h-4 w-4 animate-spin rounded-full border-2 border-slate-400/40 border-t-slate-900" />
                )}
                {isGeneratingStoryboard
                  ? 'Researching & planning…'
                  : scenes.length > 0
                    ? 'AI: Rewrite Storyboard'
                    : 'AI: Write Storyboard →'}
              </button>
              <button
                type="button"
                onClick={onNext}
                disabled={!nextState.canProceed}
                title={nextState.blockers[0] || (adFormat === 'carousel' ? 'Review generated carousel slides' : 'Start ad generation')}
                className="rounded-xl border border-white/10 bg-white/[0.06] px-5 py-3 text-sm font-semibold text-white transition hover:bg-white/[0.1] disabled:opacity-40"
              >
                {nextLabel}
              </button>
            </div>
            <p className="text-right text-[11px] text-gray-500">
              {adFormat === 'carousel'
                ? 'Carousel skips the agent run and opens slide review.'
                : 'Video formats run the agency pipeline after this step.'}
            </p>
          </div>
        </div>

        {/* Scene editor */}
        <div className="xl:col-span-4">
          <div className="sticky top-24 overflow-hidden rounded-2xl border border-white/[0.06] bg-gradient-to-b from-white/[0.04] to-transparent">
            <div className="border-b border-white/[0.06] px-4 py-3.5">
              <h3 className="text-sm font-semibold tracking-tight text-white">Scene editor</h3>
              <p className="mt-0.5 text-[11px] text-gray-500">
                {selectedScene
                  ? `Scene ${(selectedSceneIndex ?? 0) + 1}`
                  : 'Select a scene to edit'}
              </p>
            </div>

            <div className="p-4">
              {selectedScene ? (
                <div className="space-y-4">
                  <div className="space-y-2">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Image
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setImagePickerForSceneId(
                            imagePickerForSceneId === selectedScene.id ? null : selectedScene.id,
                          )
                        }
                        className="text-[11px] text-gray-400 hover:text-white"
                      >
                        {getSceneDisplayAssetId(selectedScene) ? 'Change' : 'Assign'}
                      </button>
                    </div>
                    {(() => {
                      const asset = findAssetById(getSceneDisplayAssetId(selectedScene));
                      const previewUrl = toAssetPreviewUrl(asset);
                      if (previewUrl) {
                        return (
                          <div className="relative overflow-hidden rounded-xl border border-white/[0.08]">
                            <img src={previewUrl} className="h-32 w-full object-cover" alt="" />
                            <button
                              type="button"
                              onClick={() => handleUnassignImage(selectedScene.id)}
                              className="absolute right-2 top-2 rounded-md bg-black/60 px-2 py-1 text-[10px] text-gray-200 hover:text-white"
                            >
                              Clear
                            </button>
                          </div>
                        );
                      }
                      if (sceneIntendsFreshGeneration(selectedScene)) {
                        return (
                          <div className="flex h-24 flex-col items-center justify-center rounded-xl border border-dashed border-emerald-500/30 bg-emerald-500/5 text-xs text-emerald-200">
                            Will generate fresh image
                            <button
                              type="button"
                              onClick={() => setImagePickerForSceneId(selectedScene.id)}
                              className="mt-2 text-[10px] text-gray-400 hover:text-white"
                            >
                              Or assign existing
                            </button>
                          </div>
                        );
                      }
                      return (
                        <button
                          type="button"
                          onClick={() => setImagePickerForSceneId(selectedScene.id)}
                          className="flex h-24 w-full flex-col items-center justify-center rounded-xl border border-dashed border-amber-500/30 bg-amber-500/5 text-xs text-amber-200"
                        >
                          Needs a product image — assign
                        </button>
                      );
                    })()}
                  </div>

                  {onUpdateSceneRoute && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Route
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {ROUTE_OPTIONS.map((route) => (
                          <button
                            key={route.value}
                            type="button"
                            onClick={() => onUpdateSceneRoute(selectedScene.id, route.value)}
                            className={pillClass(selectedScene.route === route.value)}
                          >
                            {route.label}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {(onUpdateSceneMotionMode || onUpdateSceneIdea) && adFormat === 'stitched_video' && (
                    <div className="space-y-2">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Motion
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {MOTION_OPTIONS.map((m) => (
                          <button
                            key={m.value}
                            type="button"
                            onClick={() => {
                              if (onUpdateSceneMotionMode) onUpdateSceneMotionMode(selectedScene.id, m.value);
                              else onUpdateSceneIdea?.(selectedScene.id, { motionMode: m.value });
                            }}
                            className={pillClass((selectedScene.motionMode || 'still') === m.value)}
                          >
                            {m.label}
                          </button>
                        ))}
                      </div>
                      <p className="text-[11px] text-gray-500">
                        {(selectedScene.motionMode || 'still') === 'live_motion'
                          ? 'Live Motion I2V will animate this still to the scene duration'
                          : 'Ken Burns still in the final stitch'}
                      </p>
                    </div>
                  )}

                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                      Voiceover / on-screen
                    </span>
                    <textarea
                      value={selectedScene.text}
                      onChange={(e) => onUpdateSceneIdea?.(selectedScene.id, { text: e.target.value })}
                      placeholder="What is said or shown…"
                      className="min-h-[56px] w-full resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20"
                    />
                  </label>

                  <label className="block space-y-1.5">
                    <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                      Visual
                    </span>
                    <textarea
                      value={selectedScene.visualDescription}
                      onChange={(e) =>
                        onUpdateSceneIdea?.(selectedScene.id, { visualDescription: e.target.value })
                      }
                      placeholder="Composition, lighting, framing…"
                      className="min-h-[56px] w-full resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20"
                    />
                  </label>

                  <div className="space-y-1.5">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-medium uppercase tracking-[0.14em] text-gray-500">
                        Image prompt
                      </span>
                      {onRewriteScene && (
                        <button
                          type="button"
                          onClick={handleRewrite}
                          disabled={isRewritingScene}
                          className="text-[11px] font-medium text-gray-400 transition hover:text-white disabled:opacity-40"
                        >
                          {isRewritingScene ? 'Rewriting…' : 'AI rewrite'}
                        </button>
                      )}
                    </div>
                    <textarea
                      value={selectedScene.imagePrompt}
                      onChange={(e) =>
                        onUpdateSceneIdea?.(selectedScene.id, { imagePrompt: e.target.value })
                      }
                      placeholder="Prompt for image generation…"
                      className="min-h-[72px] w-full resize-none rounded-xl border border-white/[0.08] bg-black/25 px-3 py-2 text-sm text-white placeholder:text-gray-600 outline-none focus:border-white/20"
                    />
                  </div>
                </div>
              ) : (
                <div className="py-10 text-center">
                  <p className="text-sm text-gray-300">No scene selected</p>
                  <p className="mt-1 text-[11px] text-gray-500">
                    Generate or add a scene, then click it to edit.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default StoryboardScreen;
