import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type {
  AspectRatio,
  BrandComplianceCheck,
  CaptionTone,
  StudioAsset,
  StudioCaptionPack,
} from './types';
import { CAPTION_TONE_PRESETS, formatCaptionForClipboard } from './captionService';
import { getAdaptFormatTargets, formatAdaptTargetLabel } from './adaptFormatService';
import VariationSetScorecardPanel from './VariationSetScorecardPanel';
import { resolveStudioAssetSrc } from './utils';

export type IterateAction =
  | 'more_like_this'
  | 'slight_variation'
  | 'stronger_brand'
  | 'less_text';

export type LightboxFrameMode = 'flat' | 'feed' | 'story';
export type OverlayFit = 'contain' | 'cover';

export function getLightboxReviewAssets(
  assets: StudioAsset[],
  initialAssetId: string,
): StudioAsset[] {
  const active = assets.find((asset) => asset.id === initialAssetId);
  if (!active?.variationSetId) return assets;
  return assets
    .filter((asset) => asset.variationSetId === active.variationSetId)
    .sort(
      (left, right) =>
        (left.variationIndex ?? Number.MAX_SAFE_INTEGER) -
        (right.variationIndex ?? Number.MAX_SAFE_INTEGER),
    );
}

export const ITERATE_PROMPTS: Record<IterateAction, { label: string; instruction: string }> = {
  more_like_this: {
    label: 'More like this',
    instruction:
      'Create another variation that stays very close to this concept and composition. Keep the same subject, framing, and brand feel with only subtle differences.',
  },
  slight_variation: {
    label: 'Slight variation',
    instruction:
      'Recreate this with a clear but related variation: keep the same product and brand feel, but visibly change at least two of camera height/crop, lighting direction, or backdrop/surface so it does not look like a near-duplicate.',
  },
  stronger_brand: {
    label: 'Stronger brand',
    instruction:
      'Strengthen brand specificity: lean harder into the brand colors, typography feel, and visual identity while keeping the same composition idea.',
  },
  less_text: {
    label: 'Less text',
    instruction:
      'Regenerate with less or no on-image text. Keep the visual strong, clean, and Instagram-ready.',
  },
};

export interface StudioLightboxProps {
  assets: StudioAsset[];
  referenceAssets?: StudioAsset[];
  initialAssetId: string;
  lockedAssetIds?: Set<string>;
  brandName?: string;
  isGenerating?: boolean;
  onClose: () => void;
  onDownload?: (asset: StudioAsset) => void;
  onCompare?: (leftId: string, rightId: string) => void;
  onIterate?: (asset: StudioAsset, action: IterateAction) => void;
  onAdaptFormat?: (asset: StudioAsset, target: AspectRatio) => void | Promise<unknown>;
  onUseAsPrompt?: (asset: StudioAsset) => void;
  onFixCompliance?: (
    asset: StudioAsset,
    check: BrandComplianceCheck,
  ) => void;
  onRecheckCompliance?: (asset: StudioAsset) => void;
  onToggleFavorite?: (assetId: string) => void;
  onKeepFavorites?: (variationSetId: string) => void;
  captionPack?: StudioCaptionPack;
  isCaptionGenerating?: boolean;
  captionProgressMessage?: string | null;
  onGenerateCaption?: (
    asset: StudioAsset,
    options?: { forceWebResearch?: boolean; tone?: CaptionTone },
  ) => void;
  onCaptionChange?: (updates: Partial<StudioCaptionPack>) => void;
  /** Opens Video Studio for multi-provider I2V on this still */
  onOpenVideoStudio?: (asset: StudioAsset) => void;
}

/**
 * Fullscreen carousel-aware lightbox with IG mock frames and reference ghost overlay.
 */
const StudioLightbox: React.FC<StudioLightboxProps> = ({
  assets,
  referenceAssets,
  initialAssetId,
  lockedAssetIds,
  brandName,
  isGenerating = false,
  onClose,
  onDownload,
  onCompare,
  onIterate,
  onAdaptFormat,
  onUseAsPrompt,
  onFixCompliance,
  onRecheckCompliance,
  onToggleFavorite,
  onKeepFavorites,
  captionPack,
  isCaptionGenerating = false,
  captionProgressMessage,
  onGenerateCaption,
  onCaptionChange,
  onOpenVideoStudio,
}) => {
  const initialIndex = Math.max(0, assets.findIndex((asset) => asset.id === initialAssetId));
  const [index, setIndex] = useState(initialIndex);
  const [showPrompt, setShowPrompt] = useState(false);
  const [frameMode, setFrameMode] = useState<LightboxFrameMode>('flat');
  const [ghostEnabled, setGhostEnabled] = useState(false);
  const [ghostOpacity, setGhostOpacity] = useState(0.3);
  const [overlayFit, setOverlayFit] = useState<OverlayFit>('contain');
  const [captionOpen, setCaptionOpen] = useState(false);
  const [toolsOpen, setToolsOpen] = useState(false);
  const [reviewScale, setReviewScale] = useState<'fit' | 'actual'>('fit');
  const [iterateOpen, setIterateOpen] = useState(false);

  const asset = assets[index] ?? assets[0];
  const availableReferences = referenceAssets ?? assets;
  const lockedPeers = useMemo(
    () =>
      availableReferences.filter(
        (item) => lockedAssetIds?.has(item.id) && item.id !== asset?.id,
      ),
    [availableReferences, lockedAssetIds, asset?.id],
  );

  const ghostReference = useMemo(() => {
    if (!asset) return null;
    const lockedProduct = lockedPeers.find((item) => item.source !== 'generated') ?? lockedPeers[0];
    if (lockedProduct) return lockedProduct;
    const sourceId = asset.sourceAssetIds?.[0];
    if (!sourceId) return null;
    return availableReferences.find((item) => item.id === sourceId) ?? null;
  }, [asset, lockedPeers, availableReferences]);

  const go = useCallback(
    (delta: number) => {
      if (assets.length === 0) return;
      setIndex((current) => (current + delta + assets.length) % assets.length);
    },
    [assets.length],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'ArrowLeft') go(-1);
      if (event.key === 'ArrowRight') go(1);
      if (event.key === 'p' || event.key === 'P') setShowPrompt((value) => !value);
      if (event.key === 'g' || event.key === 'G') setGhostEnabled((value) => !value);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [go, onClose]);

  useEffect(() => {
    const next = assets.findIndex((item) => item.id === initialAssetId);
    if (next >= 0) setIndex(next);
  }, [initialAssetId, assets]);

  const canOpenVideoStudio = Boolean(asset && resolveStudioAssetSrc(asset) && onOpenVideoStudio);

  if (!asset) return null;

  const isGenerated = asset.source === 'generated';
  const displayName = brandName || 'yourbrand';
  const variationSetId = asset.variationSetId;
  const favoriteCount = variationSetId
    ? assets.filter((item) => item.isFavorite).length
    : 0;

  const drawerOpen = captionOpen || toolsOpen || showPrompt;

  return (
    <div
      className="fixed inset-0 z-[80] flex flex-col bg-studio-canvas/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Image lightbox"
    >
      <div className="relative z-30 flex items-center justify-between gap-3 px-4 py-3 border-b border-white/10 bg-studio-canvas/85">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-white truncate">{asset.name || 'Untitled'}</p>
          <p className="text-[11px] text-gray-400">
            {index + 1} / {assets.length}
            {asset.aspectRatio ? ` · ${asset.aspectRatio}` : ''}
            {asset.variationSetId ? ' · variation set' : ''}
          </p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0">
          <label className="flex items-center gap-1.5 text-[11px] text-gray-400">
            <span className="hidden sm:inline">Frame</span>
            <select
              value={frameMode}
              onChange={(event) => {
                setFrameMode(event.target.value as LightboxFrameMode);
                setReviewScale('fit');
              }}
              aria-label="Frame mode"
              className="rounded-lg border border-white/10 bg-studio-canvas px-2.5 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent"
            >
              <option value="flat">Flat review</option>
              <option value="feed">Instagram Feed</option>
              <option value="story">Instagram Story</option>
            </select>
          </label>
          {onDownload && (
            <button
              type="button"
              onClick={() => onDownload(asset)}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10"
            >
              Download
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close lightbox"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="relative flex min-h-0 flex-1 flex-col overflow-hidden">
        {/* Image stage — chrome sits below so Fit never crops under overlays */}
        <div className="relative flex h-full min-h-0 flex-1 flex-col px-2 sm:px-10 py-3 sm:py-4">
          {assets.length > 1 && (
            <>
              <button
                type="button"
                onClick={() => go(-1)}
                className="absolute left-2 sm:left-3 top-1/2 z-10 -translate-y-1/2 w-10 h-10 rounded-full bg-studio-canvas/60 hover:bg-studio-canvas/80 text-white text-xl"
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => go(1)}
                className="absolute right-2 sm:right-3 top-1/2 z-10 -translate-y-1/2 w-10 h-10 rounded-full bg-studio-canvas/60 hover:bg-studio-canvas/80 text-white text-xl"
                aria-label="Next image"
              >
                ›
              </button>
            </>
          )}

          <div className="min-h-0 flex-1">
            <PreviewStage
              asset={asset}
              frameMode={frameMode}
              brandName={displayName}
              caption={captionPack?.caption}
              ghostReference={ghostEnabled ? ghostReference : null}
              ghostOpacity={ghostOpacity}
              overlayFit={overlayFit}
              reviewScale={reviewScale}
            />
          </div>
        </div>

        {assets.length > 1 && (
          <div className="flex flex-shrink-0 justify-center border-t border-white/5 px-3 py-2">
            <div className="flex max-w-[min(92vw,720px)] gap-1.5 overflow-x-auto rounded-xl border border-white/10 bg-studio-canvas/80 p-1.5 shadow-xl backdrop-blur-md">
              {assets.map((item, itemIndex) => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => setIndex(itemIndex)}
                  className={`relative flex-shrink-0 w-11 h-11 rounded-md overflow-hidden border transition-all ${
                    itemIndex === index
                      ? 'border-studio-accent ring-2 ring-studio-accent/40'
                      : 'border-white/10 opacity-70 hover:opacity-100'
                  }`}
                  aria-label={`Go to ${item.name || `image ${itemIndex + 1}`}`}
                >
                  <img
                    src={resolveStudioAssetSrc(item) || undefined}
                    alt=""
                    className="w-full h-full object-cover"
                  />
                  {item.isFavorite && (
                    <span className="absolute top-0.5 left-0.5 text-[10px] text-amber-300 drop-shadow">★</span>
                  )}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex flex-shrink-0 flex-wrap items-center justify-center gap-2 border-t border-white/5 px-3 py-2">
          <div className="relative">
            {isGenerated && iterateOpen && (
              <div className="absolute bottom-full left-0 mb-2 w-44 overflow-hidden rounded-xl border border-white/10 bg-studio-surface p-1 shadow-2xl">
                {(Object.keys(ITERATE_PROMPTS) as IterateAction[]).map((action) => (
                  <button
                    key={action}
                    type="button"
                    disabled={isGenerating || !onIterate}
                    onClick={() => {
                      onIterate?.(asset, action);
                      setIterateOpen(false);
                    }}
                    className="block w-full rounded-lg px-3 py-2 text-left text-xs text-gray-200 hover:bg-white/10 disabled:opacity-40"
                  >
                    {ITERATE_PROMPTS[action].label}
                  </button>
                ))}
              </div>
            )}
            {isGenerated && (
              <button
                type="button"
                onClick={() => setIterateOpen((value) => !value)}
                aria-expanded={iterateOpen}
                className="rounded-lg border border-studio-accent/30 bg-studio-canvas/80 px-3 py-2 text-xs font-medium text-teal-50 backdrop-blur-md"
              >
                Iterate ▾
              </button>
            )}
          </div>
          {canOpenVideoStudio && (
            <button
              type="button"
              onClick={() => onOpenVideoStudio?.(asset)}
              className="rounded-lg border border-studio-accent/30 bg-studio-canvas/80 px-3 py-2 text-xs font-medium text-teal-50 backdrop-blur-md"
            >
              Animate
            </button>
          )}
          {frameMode === 'flat' && (
            <div className="flex rounded-lg border border-white/10 bg-studio-canvas/80 p-0.5 backdrop-blur-md" role="group" aria-label="Review zoom">
              <button
                type="button"
                onClick={() => setReviewScale('fit')}
                aria-pressed={reviewScale === 'fit'}
                className={`rounded-md px-2.5 py-1.5 text-xs ${reviewScale === 'fit' ? 'bg-white/15 text-white' : 'text-gray-400'}`}
              >
                Fit
              </button>
              <button
                type="button"
                onClick={() => setReviewScale('actual')}
                aria-pressed={reviewScale === 'actual'}
                className={`rounded-md px-2.5 py-1.5 text-xs ${reviewScale === 'actual' ? 'bg-white/15 text-white' : 'text-gray-400'}`}
              >
                100%
              </button>
            </div>
          )}
          {onGenerateCaption && (
            <button type="button" onClick={() => { setCaptionOpen((v) => !v); setToolsOpen(false); setShowPrompt(false); }} className="rounded-lg border border-white/15 bg-studio-canvas/80 px-3 py-2 text-xs text-gray-200 backdrop-blur-md">Caption</button>
          )}
          <button type="button" onClick={() => { setToolsOpen((v) => !v); setCaptionOpen(false); setShowPrompt(false); }} className="rounded-lg border border-white/15 bg-studio-canvas/80 px-3 py-2 text-xs text-gray-200 backdrop-blur-md">Tools</button>
          {isGenerated && asset.generationPrompt && (
            <button type="button" onClick={() => { setShowPrompt((v) => !v); setCaptionOpen(false); setToolsOpen(false); }} className="rounded-lg border border-white/15 bg-studio-canvas/80 px-3 py-2 text-xs text-gray-200 backdrop-blur-md">Prompt</button>
          )}
        </div>
      </div>

      {drawerOpen && (
        <aside
          className="fixed inset-x-0 bottom-0 z-40 max-h-[42vh] overflow-y-auto overscroll-contain rounded-t-2xl border-t border-white/10 bg-studio-surface/95 p-3 shadow-2xl backdrop-blur-xl md:absolute md:inset-y-[61px] md:left-auto md:right-0 md:max-h-none md:w-[min(380px,38vw)] md:rounded-none md:border-l md:border-t-0"
          aria-label="Review details"
        >
          <div className="mb-3 flex items-center justify-between">
            <p className="text-xs font-semibold text-white">
              {captionOpen ? 'Caption' : toolsOpen ? 'Review tools' : 'Prompt'}
            </p>
            <button type="button" onClick={() => { setCaptionOpen(false); setToolsOpen(false); setShowPrompt(false); }} aria-label="Close review details" className="h-8 w-8 rounded-full text-gray-300 hover:bg-white/10">✕</button>
          </div>
        {captionOpen && onGenerateCaption && (
          <div>
            <CaptionPanel
              captionPack={captionPack}
              isGenerating={isCaptionGenerating}
              progressMessage={captionProgressMessage}
              expanded
              onToggle={() => setCaptionOpen(false)}
              carouselSlideCount={
                variationSetId
                  ? assets.filter((item) => item.variationSetId === variationSetId).length
                  : undefined
              }
              onGenerate={(options) => onGenerateCaption(asset, options)}
              onChange={onCaptionChange}
            />
          </div>
        )}

        {showPrompt && isGenerated && asset.generationPrompt && (
          <div className="rounded-xl border border-white/10 bg-studio-canvas/50 px-3 py-2">
            <p className="text-[10px] uppercase tracking-widest text-teal-200 font-semibold mb-1">Prompt</p>
            <p className="text-xs text-gray-200 leading-relaxed whitespace-pre-wrap">{asset.generationPrompt}</p>
          </div>
        )}

        {toolsOpen && (
          <div className="space-y-3">
            {ghostReference && (
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  onClick={() => setGhostEnabled((value) => !value)}
                  className={`px-3 py-1.5 rounded-full text-[11px] font-medium border ${
                    ghostEnabled
                      ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                      : 'border-white/15 bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  Ghost reference {ghostEnabled ? 'on' : 'off'}
                </button>
                {ghostEnabled && (
                  <>
                    <label className="flex items-center gap-2 text-[11px] text-gray-400">
                      Opacity
                      <input
                        type="range"
                        min={10}
                        max={70}
                        value={Math.round(ghostOpacity * 100)}
                        onChange={(event) => setGhostOpacity(Number(event.target.value) / 100)}
                        className="w-24"
                        aria-label="Ghost overlay opacity"
                      />
                    </label>
                    {frameMode === 'flat' && (
                      <div
                        className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5"
                        role="radiogroup"
                        aria-label="Overlay alignment"
                      >
                        {(['contain', 'cover'] as OverlayFit[]).map((fit) => (
                          <button
                            key={fit}
                            type="button"
                            role="radio"
                            aria-checked={overlayFit === fit}
                            onClick={() => setOverlayFit(fit)}
                            className={`rounded-md px-2 py-1 text-[10px] capitalize ${
                              overlayFit === fit ? 'bg-amber-500/20 text-amber-100' : 'text-gray-400'
                            }`}
                          >
                            {fit}
                          </button>
                        ))}
                      </div>
                    )}
                  </>
                )}
              </div>
            )}

            {isGenerated && (
              <BrandCompliancePanel
                asset={asset}
                hasBrandContext={Boolean(brandName)}
                isGenerating={isGenerating}
                onFix={onFixCompliance}
                onRecheck={onRecheckCompliance}
              />
            )}

            {variationSetId && (
              <VariationSetScorecardPanel
                assets={assets}
                variationSetId={variationSetId}
                activeAssetId={asset.id}
                onSelectAsset={(id) => {
                  const idx = assets.findIndex((a) => a.id === id);
                  if (idx >= 0) setIndex(idx);
                }}
              />
            )}

            {isGenerated && (
              <div className="flex flex-wrap gap-2">
                {variationSetId && onToggleFavorite && (
                  <button
                    type="button"
                    onClick={() => onToggleFavorite(asset.id)}
                    className={`px-3 py-1.5 rounded-full text-[11px] font-medium border ${
                      asset.isFavorite
                        ? 'border-amber-300/50 bg-amber-400/20 text-amber-100'
                        : 'border-white/15 bg-white/5 text-gray-200 hover:bg-white/10'
                    }`}
                    aria-pressed={Boolean(asset.isFavorite)}
                  >
                    {asset.isFavorite ? '★ Favorited' : '☆ Favorite'}
                  </button>
                )}
                {variationSetId && onKeepFavorites && (
                  <button
                    type="button"
                    disabled={favoriteCount === 0 || favoriteCount === assets.length}
                    onClick={() => onKeepFavorites(variationSetId)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-amber-400/30 bg-amber-500/10 text-amber-100 hover:bg-amber-500/20 disabled:cursor-not-allowed disabled:opacity-40"
                  >
                    Keep {favoriteCount} favorite{favoriteCount === 1 ? '' : 's'}
                  </button>
                )}
                {onAdaptFormat &&
                  getAdaptFormatTargets(asset.aspectRatio).map((ratio) => (
                    <button
                      key={`adapt-${ratio}`}
                      type="button"
                      disabled={isGenerating}
                      onClick={() => onAdaptFormat(asset, ratio)}
                      className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-cyan-400/35 bg-cyan-500/15 text-cyan-50 hover:bg-cyan-500/25 disabled:opacity-40"
                      title={`Gemini reframe into ${formatAdaptTargetLabel(ratio)} — not a crop`}
                    >
                      Adapt → {formatAdaptTargetLabel(ratio)}
                    </button>
                  ))}
                {onUseAsPrompt && asset.generationPrompt && (
                  <button
                    type="button"
                    onClick={() => onUseAsPrompt(asset)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-white/15 bg-white/5 text-gray-200 hover:bg-white/10"
                  >
                    Use prompt
                  </button>
                )}
                {onCompare && lockedPeers[0] && (
                  <button
                    type="button"
                    onClick={() => onCompare(lockedPeers[0].id, asset.id)}
                    className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
                  >
                    Compare with locked
                  </button>
                )}
              </div>
            )}
          </div>
        )}
        </aside>
      )}
    </div>
  );
};

const CaptionPanel: React.FC<{
  captionPack?: StudioCaptionPack;
  isGenerating: boolean;
  progressMessage?: string | null;
  /** When viewing a variation set, number of slides in that set */
  carouselSlideCount?: number;
  expanded: boolean;
  onToggle: () => void;
  onGenerate: (options?: { forceWebResearch?: boolean; tone?: CaptionTone }) => void;
  onChange?: (updates: Partial<StudioCaptionPack>) => void;
}> = ({
  captionPack,
  isGenerating,
  progressMessage,
  carouselSlideCount,
  expanded,
  onToggle,
  onGenerate,
  onChange,
}) => {
  const [tone, setTone] = useState<CaptionTone>(captionPack?.tone || 'story');
  const [showMore, setShowMore] = useState(false);
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const slideCount =
    carouselSlideCount && carouselSlideCount >= 2
      ? carouselSlideCount
      : captionPack?.slideCount && captionPack.slideCount >= 2
        ? captionPack.slideCount
        : undefined;

  const hasRealCaption = Boolean(captionPack?.caption?.trim());
  const isFallbackCaption =
    captionPack?.generationStatus === 'fallback' ||
    (!captionPack?.generationStatus &&
      captionPack?.researchSummary?.startsWith('Caption AI failed'));
  const isFailedCaption = captionPack?.generationStatus === 'failed';
  const looksLikeFailedStub =
    isFallbackCaption ||
    isFailedCaption ||
    (hasRealCaption &&
      /^(share this moment\.?|discover .+)$/i.test(captionPack!.caption.trim()) &&
      !(captionPack?.hashtags?.length));

  useEffect(() => {
    if (captionPack?.tone) setTone(captionPack.tone);
  }, [captionPack?.tone]);

  useEffect(() => {
    if (copyState === 'idle') return;
    const timer = window.setTimeout(() => setCopyState('idle'), 1600);
    return () => window.clearTimeout(timer);
  }, [copyState]);

  const hashtagsText = (captionPack?.hashtags || []).map((tag) =>
    tag.startsWith('#') ? tag : `#${tag}`,
  ).join(' ');

  const handleCopy = async () => {
    if (!captionPack) return;
    const text = formatCaptionForClipboard(captionPack);
    try {
      await navigator.clipboard.writeText(text);
      setCopyState('copied');
    } catch {
      setCopyState('failed');
    }
  };

  if (!expanded) {
    return (
      <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2 flex flex-wrap items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium text-gray-200">Instagram caption</p>
          <p className="text-[10px] text-gray-500 truncate">
            {hasRealCaption && !looksLikeFailedStub
              ? captionPack!.caption
              : 'Optional — generate when you are ready to post'}
          </p>
        </div>
        <div className="flex gap-1.5 flex-shrink-0">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onGenerate({ tone, forceWebResearch: tone === 'viral' })}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-sky-400/40 bg-sky-500/20 text-sky-50 hover:bg-sky-500/30 disabled:opacity-40"
          >
            {isGenerating ? 'Writing…' : hasRealCaption ? 'Regenerate' : 'Write caption'}
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-white/15 bg-white/5 text-gray-300 hover:bg-white/10"
          >
            Expand
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-xl border border-sky-500/25 bg-sky-500/10 px-3 py-2.5 space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-sky-200 font-semibold">
            Caption
          </p>
          <p className="text-[11px] text-sky-100/80">
            {slideCount
              ? `Caption for ${slideCount}-slide set`
              : 'Write Instagram caption for this image (optional)'}
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onGenerate({ tone, forceWebResearch: false })}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-sky-400/40 bg-sky-500/20 text-sky-50 hover:bg-sky-500/30 disabled:opacity-40"
          >
            {isGenerating ? 'Writing…' : hasRealCaption ? 'Regenerate' : 'Research & generate'}
          </button>
          {hasRealCaption && !isFailedCaption && (
            <button
              type="button"
              onClick={() => { void handleCopy(); }}
              className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-emerald-400/30 bg-emerald-500/10 text-emerald-100 hover:bg-emerald-500/20"
            >
              {copyState === 'copied' ? 'Copied' : copyState === 'failed' ? 'Copy failed' : 'Copy'}
            </button>
          )}
          <button
            type="button"
            onClick={() => setShowMore((value) => !value)}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-white/15 bg-white/5 text-gray-300 hover:bg-white/10"
            aria-expanded={showMore}
          >
            More
          </button>
          <button
            type="button"
            onClick={onToggle}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-white/10 text-gray-400 hover:text-white"
          >
            Collapse
          </button>
        </div>
      </div>

      <div
        className="flex flex-wrap items-center gap-1.5"
        role="radiogroup"
        aria-label="Caption tone"
      >
        {(Object.keys(CAPTION_TONE_PRESETS) as CaptionTone[]).map((preset) => (
          <button
            key={preset}
            type="button"
            role="radio"
            aria-checked={tone === preset}
            disabled={isGenerating}
            onClick={() => setTone(preset)}
            className={`px-2.5 py-1 rounded-full text-[10px] font-medium border ${
              tone === preset
                ? 'border-sky-300/50 bg-sky-400/20 text-sky-50'
                : 'border-white/10 bg-studio-canvas/20 text-gray-300 hover:bg-white/10'
            }`}
            title={CAPTION_TONE_PRESETS[preset].hint}
          >
            {CAPTION_TONE_PRESETS[preset].label}
          </button>
        ))}
      </div>

      {showMore && (
        <div className="flex flex-wrap gap-1.5">
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onGenerate({ tone, forceWebResearch: true })}
            className="px-3 py-1.5 rounded-full text-[11px] font-medium border border-white/15 bg-white/5 text-gray-200 hover:bg-white/10 disabled:opacity-40"
            title="Force live web research even if brand context exists"
          >
            Force research
          </button>
        </div>
      )}

      {(isGenerating || progressMessage) && (
        <p className="text-[11px] text-sky-100/90" role="status" aria-live="polite">
          {progressMessage || 'Working…'}
        </p>
      )}

      {looksLikeFailedStub && (
        <p className="text-[11px] text-amber-200/90 rounded-lg border border-amber-400/30 bg-amber-500/10 px-2.5 py-1.5">
          {isFailedCaption
            ? captionPack?.generationError ||
              'Caption generation failed — retry before copying or publishing.'
            : 'This is a fallback, not an AI-grounded caption — hit Regenerate (or Force research) to retry.'}
        </p>
      )}

      {hasRealCaption ? (
        <div className="space-y-2">
          <label className="block space-y-1">
            <span className="text-[10px] text-gray-400">Caption</span>
            <textarea
              value={captionPack!.caption}
              onChange={(event) => onChange?.({ caption: event.target.value })}
              rows={3}
              className="w-full rounded-lg border border-white/10 bg-studio-canvas/40 px-2.5 py-2 text-xs text-gray-100 placeholder:text-gray-500 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
              aria-label="Instagram caption"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-gray-400">Hashtags</span>
            <input
              type="text"
              value={hashtagsText}
              onChange={(event) =>
                onChange?.({
                  hashtags: event.target.value
                    .split(/[\s,]+/)
                    .map((tag) => tag.replace(/^#+/, '').trim())
                    .filter(Boolean),
                })
              }
              placeholder="#brand #product …"
              className="w-full rounded-lg border border-white/10 bg-studio-canvas/40 px-2.5 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
              aria-label="Hashtags"
            />
          </label>
          <label className="block space-y-1">
            <span className="text-[10px] text-gray-400">Alt text</span>
            <input
              type="text"
              value={captionPack?.altText || ''}
              onChange={(event) => onChange?.({ altText: event.target.value })}
              placeholder="Describe what is visible in the image"
              className="w-full rounded-lg border border-white/10 bg-studio-canvas/40 px-2.5 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-sky-400/50"
              aria-label="Alt text"
            />
          </label>
          {captionPack?.researchSummary && !looksLikeFailedStub && (
            <p className="text-[10px] text-gray-400">{captionPack.researchSummary}</p>
          )}
        </div>
      ) : (
        !isGenerating && (
          <p className="text-[11px] text-sky-100/70">
            Pick a tone, then generate. Caption stays out of the way until you need it for posting.
          </p>
        )
      )}
    </div>
  );
};

const BrandCompliancePanel: React.FC<{
  asset: StudioAsset;
  hasBrandContext: boolean;
  isGenerating: boolean;
  onFix?: (asset: StudioAsset, check: BrandComplianceCheck) => void;
  onRecheck?: (asset: StudioAsset) => void;
}> = ({ asset, hasBrandContext, isGenerating, onFix, onRecheck }) => {
  if (asset.brandCompliancePending) {
    return (
      <div
        className="flex items-center gap-2 rounded-xl border border-studio-accent/25 bg-studio-accent/10 px-3 py-2 text-xs text-teal-50"
        role="status"
        aria-live="polite"
      >
        <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-teal-300" />
        Checking brand compliance…
      </div>
    );
  }

  const report = asset.brandCompliance;
  if (!report) {
    return (
      <div className="flex items-center justify-between gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
        <div>
          <p className="text-xs font-medium text-gray-200">Brand compliance</p>
          <p className="text-[10px] text-gray-500">
            {hasBrandContext
              ? 'This image has not been checked yet.'
              : 'Research the brand to enable visual compliance checks.'}
          </p>
        </div>
        {hasBrandContext && onRecheck && (
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onRecheck(asset)}
            className="flex-shrink-0 rounded-lg border border-studio-accent/30 bg-studio-accent/15 px-3 py-1.5 text-[11px] font-medium text-teal-50 hover:bg-studio-accent/25 disabled:opacity-40"
          >
            Check now
          </button>
        )}
      </div>
    );
  }

  const scoreClasses =
    report.status === 'pass'
      ? 'border-emerald-400/40 bg-emerald-500/15 text-emerald-100'
      : report.status === 'warning'
        ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
        : 'border-red-400/40 bg-red-500/15 text-red-100';

  return (
    <details className="group rounded-xl border border-white/10 bg-white/[0.03]">
      <summary className="flex cursor-pointer list-none items-center gap-3 px-3 py-2">
        <span
          className={`grid h-10 w-10 flex-shrink-0 place-items-center rounded-full border text-sm font-bold ${scoreClasses}`}
          aria-label={`Brand compliance score ${report.score} out of 100`}
        >
          {report.score}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="text-xs font-semibold text-white">
              Brand compliance
            </p>
            {report.evaluationMode === 'limited' && (
              <span className="rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase text-amber-200">
                Limited
              </span>
            )}
          </div>
          <p className="truncate text-[10px] text-gray-400">
            {report.summary}
          </p>
        </div>
        <span className="text-[10px] text-gray-500 group-open:hidden">
          Details
        </span>
        <span className="hidden text-[10px] text-gray-500 group-open:inline">
          Hide
        </span>
      </summary>

      <div className="max-h-52 space-y-1.5 overflow-y-auto border-t border-white/10 px-3 py-2">
        {report.checks.map((check) => (
          <div
            key={check.category}
            className="flex items-start gap-2 rounded-lg bg-studio-canvas/20 px-2.5 py-2"
          >
            <span
              className={`mt-0.5 text-xs ${
                check.status === 'pass'
                  ? 'text-emerald-300'
                  : check.status === 'warning'
                    ? 'text-amber-300'
                    : 'text-red-300'
              }`}
              aria-hidden="true"
            >
              {check.status === 'pass'
                ? '✓'
                : check.status === 'warning'
                  ? '!'
                  : '×'}
            </span>
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[11px] font-medium text-gray-100">
                  {check.label}
                </p>
                <span className="text-[10px] text-gray-500">
                  {check.score}/100
                </span>
              </div>
              <p className="text-[10px] leading-relaxed text-gray-400">
                {check.finding}
              </p>
              {check.recommendation && check.status !== 'pass' && (
                <p className="mt-0.5 text-[10px] leading-relaxed text-gray-500">
                  Fix: {check.recommendation}
                </p>
              )}
            </div>
            {check.status !== 'pass' && onFix && (
              <button
                type="button"
                disabled={isGenerating}
                onClick={() => onFix(asset, check)}
                className="flex-shrink-0 rounded-md border border-studio-accent/25 bg-studio-accent/10 px-2 py-1 text-[10px] font-medium text-teal-50 hover:bg-studio-accent/20 disabled:opacity-40"
                aria-label={`Fix ${check.label}`}
              >
                Fix
              </button>
            )}
          </div>
        ))}
        {onRecheck && (
          <button
            type="button"
            disabled={isGenerating}
            onClick={() => onRecheck(asset)}
            className="w-full rounded-lg border border-white/10 px-3 py-1.5 text-[10px] font-medium text-gray-300 hover:bg-white/5 hover:text-white disabled:opacity-40"
          >
            Recheck image
          </button>
        )}
      </div>
    </details>
  );
};

const PreviewStage: React.FC<{
  asset: StudioAsset;
  frameMode: LightboxFrameMode;
  brandName: string;
  caption?: string;
  ghostReference: StudioAsset | null;
  ghostOpacity: number;
  overlayFit: OverlayFit;
  reviewScale: 'fit' | 'actual';
}> = ({ asset, frameMode, brandName, caption, ghostReference, ghostOpacity, overlayFit, reviewScale }) => {
  const assetSrc = resolveStudioAssetSrc(asset);
  const ghostSrc = ghostReference ? resolveStudioAssetSrc(ghostReference) : undefined;

  if (frameMode === 'flat') {
    // Review mode: never crop. Explicit h-full chain so max-height % works (inline-flex broke Fit).
    return (
      <div
        className={`relative flex h-full w-full items-center justify-center ${
          reviewScale === 'actual' ? 'overflow-auto items-start justify-start p-2' : 'overflow-hidden'
        }`}
      >
        {assetSrc ? (
          <div
            className={`relative rounded-lg bg-black/30 shadow-2xl ${
              reviewScale === 'fit'
                ? 'flex h-full w-full items-center justify-center'
                : 'm-auto flex-none'
            }`}
          >
            <img
              src={assetSrc}
              alt={asset.name || 'Preview'}
              className={
                reviewScale === 'fit'
                  ? 'max-h-full max-w-full h-auto w-auto object-contain'
                  : 'h-auto w-auto max-w-none'
              }
            />
            {ghostReference && ghostSrc && (
              <img
                src={ghostSrc}
                alt="Ghost reference"
                className="pointer-events-none absolute inset-0 h-full w-full"
                style={{ opacity: ghostOpacity, objectFit: overlayFit }}
              />
            )}
          </div>
        ) : (
          <div className="flex h-48 w-72 items-center justify-center rounded-lg bg-studio-canvas text-sm text-gray-500">
            Preview unavailable
          </div>
        )}
      </div>
    );
  }

  if (frameMode === 'story') {
    return (
      <div className="relative flex h-full max-h-full flex-col items-center justify-center gap-2">
        <p className="text-[10px] uppercase tracking-widest text-gray-500">
          IG Story mock · full image letterboxed · publishing may crop edges
        </p>
        <div className="relative w-[min(320px,70vw)] max-h-full aspect-[9/16] rounded-[2rem] border-[6px] border-zinc-800 bg-zinc-950 shadow-2xl overflow-hidden">
          <div className="absolute top-0 inset-x-0 z-20 px-3 pt-3">
            <div className="h-0.5 rounded-full bg-white/80 mb-3" />
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-full bg-gradient-to-br from-fuchsia-500 to-amber-400 p-[1px]">
                <div className="w-full h-full rounded-full bg-zinc-900" />
              </div>
              <span className="text-[11px] font-semibold text-white drop-shadow">{brandName}</span>
              <span className="text-[10px] text-white/70">1h</span>
            </div>
          </div>
          {assetSrc ? (
            <img
              src={assetSrc}
              alt={asset.name || 'Story preview'}
              className="absolute inset-0 w-full h-full object-contain bg-zinc-950"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
              Preview unavailable
            </div>
          )}
          {ghostReference && ghostSrc && (
            <img
              src={ghostSrc}
              alt="Ghost reference"
              className="pointer-events-none absolute inset-0 w-full h-full object-contain"
              style={{ opacity: ghostOpacity }}
            />
          )}
        </div>
      </div>
    );
  }

  // Feed mock — letterbox so review never silently crops the generation
  return (
    <div className="flex h-full max-h-full flex-col items-center justify-center gap-2">
      <p className="text-[10px] uppercase tracking-widest text-gray-500">
        IG Feed mock · full image letterboxed · publishing may crop edges
      </p>
      <div className="w-[min(380px,85vw)] max-h-full rounded-2xl border border-white/10 bg-zinc-950 shadow-2xl overflow-hidden flex flex-col">
        <div className="flex items-center gap-2.5 px-3 py-2.5 border-b border-white/5 flex-shrink-0">
          <div className="w-8 h-8 rounded-full bg-gradient-to-br from-fuchsia-500 via-rose-500 to-amber-400 p-[1.5px]">
            <div className="w-full h-full rounded-full bg-zinc-900" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold text-white truncate">{brandName}</p>
            <p className="text-[10px] text-gray-500">Sponsored</p>
          </div>
          <span className="text-gray-500 text-sm">•••</span>
        </div>
        <div className="relative aspect-[4/5] max-h-[min(52vh,560px)] bg-zinc-950">
          {assetSrc ? (
            <img
              src={assetSrc}
              alt={asset.name || 'Feed preview'}
              className="absolute inset-0 w-full h-full object-contain"
            />
          ) : (
            <div className="absolute inset-0 flex items-center justify-center text-sm text-gray-500">
              Preview unavailable
            </div>
          )}
          {ghostReference && ghostSrc && (
            <img
              src={ghostSrc}
              alt="Ghost reference"
              className="pointer-events-none absolute inset-0 w-full h-full object-contain"
              style={{ opacity: ghostOpacity }}
            />
          )}
        </div>
        <div className="px-3 py-2.5 space-y-1.5 flex-shrink-0">
          <div className="flex items-center gap-4 text-white text-sm">
            <span>♡</span>
            <span>💬</span>
            <span>➢</span>
            <span className="ml-auto">bookmark</span>
          </div>
          <p className="text-[11px] text-gray-300 line-clamp-2">
            <span className="font-semibold text-white">{brandName}</span>{' '}
            {caption?.trim() || 'Your caption appears here…'}
          </p>
        </div>
      </div>
    </div>
  );
};

export default StudioLightbox;
