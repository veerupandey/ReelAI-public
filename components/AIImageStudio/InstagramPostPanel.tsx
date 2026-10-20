import React, { useCallback, useMemo, useState } from 'react';
import type { CaptionTone, StudioAsset, StudioCaptionPack } from './types';
import {
  CAPTION_TONE_PRESETS,
  formatCaptionForClipboard,
} from './captionService';
import { resolveStudioAssetSrc } from './utils';
import {
  isInstagramConfigured,
  publishCarousel,
  publishSingleImage,
} from '../../services/instagramPublishService';
import {
  hostStudioImagesForPublish,
  isStudioImageHostingConfigured,
} from './studioImageHostService';

export interface InstagramPostPanelProps {
  assets: StudioAsset[];
  postQueueIds: string[];
  captionPack?: StudioCaptionPack;
  isCaptionGenerating?: boolean;
  captionProgressMessage?: string | null;
  brandName?: string;
  onClose: () => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onRemoveFromQueue: (id: string) => void;
  onClearQueue: () => void;
  /** Generate / regenerate caption (research-driven when tone is viral or forceResearch). */
  onGenerateCaption: (opts?: { tone?: CaptionTone; forceWebResearch?: boolean }) => void;
  /** Revise existing caption with a short instruction. */
  onReviseCaption: (instruction: string) => void;
  onCaptionChange: (updates: Partial<StudioCaptionPack>) => void;
  onExportOrderedPack: () => void;
  onPublished?: (permalink?: string) => void;
  onError?: (message: string) => void;
}

const TONE_OPTIONS: CaptionTone[] = ['viral', 'short', 'story', 'promo'];

/**
 * Compose an ordered Instagram post from the selection queue (click order = slide order).
 * Caption generate / edit / copy work without Instagram API tokens.
 */
const InstagramPostPanel: React.FC<InstagramPostPanelProps> = ({
  assets,
  postQueueIds,
  captionPack,
  isCaptionGenerating = false,
  captionProgressMessage,
  brandName,
  onClose,
  onReorder,
  onRemoveFromQueue,
  onClearQueue,
  onGenerateCaption,
  onReviseCaption,
  onCaptionChange,
  onExportOrderedPack,
  onPublished,
  onError,
}) => {
  const [isPublishing, setIsPublishing] = useState(false);
  const [copied, setCopied] = useState<'all' | 'caption' | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [selectedTone, setSelectedTone] = useState<CaptionTone>(
    () => captionPack?.tone || 'viral',
  );
  const [reviseText, setReviseText] = useState('');
  const [showRevise, setShowRevise] = useState(false);

  const slides = useMemo(() => {
    const byId = new Map(assets.map((a) => [a.id, a]));
    return postQueueIds
      .map((id) => byId.get(id))
      .filter((a): a is StudioAsset => Boolean(a));
  }, [assets, postQueueIds]);

  const igConfigured = isInstagramConfigured();
  const hostingConfigured = isStudioImageHostingConfigured();
  const canLivePost = igConfigured && hostingConfigured && slides.length > 0;
  const hasCaptionText = Boolean(captionPack?.caption?.trim());
  const isFallbackCaption = Boolean(
    captionPack?.generationStatus === 'fallback' ||
      (!captionPack?.generationStatus &&
        captionPack?.researchSummary?.startsWith('Caption AI failed')),
  );
  const isFailedCaption = captionPack?.generationStatus === 'failed';
  const canUseCaption = hasCaptionText && !isFailedCaption;

  const hashtagsText = (captionPack?.hashtags || [])
    .map((tag) => (tag.startsWith('#') ? tag : `#${tag}`))
    .join(' ');

  const handleCopyAll = useCallback(async () => {
    if (!captionPack?.caption?.trim()) {
      onError?.('Generate or type a caption first');
      return;
    }
    const text = formatCaptionForClipboard(captionPack);
    try {
      await navigator.clipboard.writeText(text);
      setCopied('all');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onError?.('Could not copy to clipboard');
    }
  }, [captionPack, onError]);

  const handleCopyCaptionOnly = useCallback(async () => {
    if (!captionPack?.caption?.trim()) {
      onError?.('Generate or type a caption first');
      return;
    }
    try {
      await navigator.clipboard.writeText(captionPack.caption.trim());
      setCopied('caption');
      setTimeout(() => setCopied(null), 2000);
    } catch {
      onError?.('Could not copy to clipboard');
    }
  }, [captionPack, onError]);

  const handleOpenInstagram = useCallback(() => {
    window.open('https://www.instagram.com/', '_blank', 'noopener,noreferrer');
  }, []);

  const handleGenerate = useCallback(() => {
    // Always research hashtags/trends for Instagram compose — not only Viral tone.
    onGenerateCaption({
      tone: selectedTone,
      forceWebResearch: true,
    });
  }, [onGenerateCaption, selectedTone]);

  const handleRetry = useCallback(() => {
    onGenerateCaption({
      tone: selectedTone,
      forceWebResearch: true,
    });
  }, [onGenerateCaption, selectedTone]);

  const handleReviseSubmit = useCallback(() => {
    const instruction = reviseText.trim();
    if (!instruction) {
      onError?.('Add a revise direction (e.g. shorter, more playful, add urgency)');
      return;
    }
    if (!captionPack?.caption?.trim()) {
      onError?.('Generate a caption first, then revise it');
      return;
    }
    onReviseCaption(instruction);
    setShowRevise(false);
  }, [reviseText, captionPack, onReviseCaption, onError]);

  const handlePublish = useCallback(async () => {
    if (!canLivePost) {
      setStatusMessage(
        !igConfigured
          ? 'Set VITE_IG_ACCESS_TOKEN and VITE_IG_BUSINESS_ACCOUNT_ID to enable live posting.'
          : 'Set Supabase Storage (public studio-publish bucket) to host images for Instagram.',
      );
      return;
    }

    setIsPublishing(true);
    setStatusMessage(null);
    try {
      const urls = await hostStudioImagesForPublish(slides);
      const caption = captionPack
        ? formatCaptionForClipboard(captionPack)
        : '';
      const result =
        urls.length === 1
          ? await publishSingleImage(urls[0], caption)
          : await publishCarousel(urls, caption);

      if (result.status === 'failed') {
        throw new Error(result.error || 'Instagram publish failed');
      }
      setStatusMessage(
        result.permalink
          ? `Published — ${result.permalink}`
          : 'Published to Instagram',
      );
      onPublished?.(result.permalink);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Publish failed';
      setStatusMessage(message);
      onError?.(message);
    } finally {
      setIsPublishing(false);
    }
  }, [
    canLivePost,
    igConfigured,
    slides,
    captionPack,
    onPublished,
    onError,
  ]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-studio-canvas/70"
      role="dialog"
      aria-modal="true"
      aria-label="Instagram post composer"
    >
      <button
        type="button"
        className="absolute inset-0 cursor-default"
        aria-label="Close"
        onClick={onClose}
      />
      <div className="relative z-10 flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-t-2xl border border-studio-border bg-studio-surface shadow-2xl sm:rounded-2xl">
        <div className="flex items-center justify-between border-b border-studio-border px-4 py-3">
          <div>
            <h2 className="text-sm font-semibold text-studio-ink">
              Instagram post
            </h2>
            <p className="text-[11px] text-studio-mist">
              {brandName ? `${brandName} · ` : ''}
              {slides.length} slide{slides.length === 1 ? '' : 's'} in selection order
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg px-2 py-1 text-sm text-gray-400 hover:bg-white/10 hover:text-white"
          >
            ✕
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto p-4">
          {slides.length === 0 ? (
            <p className="text-sm text-studio-mist">
              Add images to the post queue from the gallery (IG+ or Alt+click). Order = swipe order.
            </p>
          ) : (
            <div className="flex gap-2 overflow-x-auto pb-1">
              {slides.map((slide, index) => {
                const src = resolveStudioAssetSrc(slide);
                return (
                  <div
                    key={slide.id}
                    className="relative w-24 flex-shrink-0 space-y-1"
                  >
                    <div className="relative aspect-square overflow-hidden rounded-lg border border-studio-border bg-studio-canvas">
                      {src ? (
                        <img
                          src={src}
                          alt={slide.name}
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <div className="flex h-full items-center justify-center text-[10px] text-gray-500">
                          {index + 1}
                        </div>
                      )}
                      <span className="absolute left-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-gradient-to-br from-[#f09433] to-[#dc2743] text-[10px] font-bold text-white">
                        {index + 1}
                      </span>
                    </div>
                    <div className="flex gap-0.5">
                      <button
                        type="button"
                        disabled={index === 0}
                        onClick={() => onReorder(index, index - 1)}
                        className="flex-1 rounded px-1 py-0.5 text-[10px] text-gray-300 hover:bg-white/10 disabled:opacity-30"
                        aria-label={`Move slide ${index + 1} earlier`}
                      >
                        ←
                      </button>
                      <button
                        type="button"
                        disabled={index === slides.length - 1}
                        onClick={() => onReorder(index, index + 1)}
                        className="flex-1 rounded px-1 py-0.5 text-[10px] text-gray-300 hover:bg-white/10 disabled:opacity-30"
                        aria-label={`Move slide ${index + 1} later`}
                      >
                        →
                      </button>
                      <button
                        type="button"
                        onClick={() => onRemoveFromQueue(slide.id)}
                        className="flex-1 rounded px-1 py-0.5 text-[10px] text-red-300 hover:bg-red-500/20"
                        aria-label={`Remove slide ${index + 1}`}
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          <div className="space-y-3 rounded-xl border border-studio-border bg-studio-bg/60 p-3">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[10px] uppercase tracking-wide text-studio-mist mr-1">
                Tone
              </span>
              {TONE_OPTIONS.map((tone) => (
                <button
                  key={tone}
                  type="button"
                  disabled={isCaptionGenerating}
                  onClick={() => setSelectedTone(tone)}
                  className={`rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-40 ${
                    selectedTone === tone
                      ? 'bg-gradient-to-r from-[#f09433]/80 to-[#dc2743]/80 text-white'
                      : 'border border-studio-border text-studio-mist hover:bg-white/8 hover:text-studio-ink'
                  }`}
                >
                  {CAPTION_TONE_PRESETS[tone].label}
                </button>
              ))}
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={slides.length === 0 || isCaptionGenerating}
                onClick={handleGenerate}
                className="rounded-lg bg-gradient-to-r from-[#f09433] to-[#dc2743] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
              >
                {isCaptionGenerating
                  ? 'Writing caption…'
                  : hasCaptionText
                    ? `Regenerate (${CAPTION_TONE_PRESETS[selectedTone].label})`
                    : `Generate ${CAPTION_TONE_PRESETS[selectedTone].label.toLowerCase()} caption`}
              </button>
              <button
                type="button"
                disabled={slides.length === 0 || isCaptionGenerating}
                onClick={handleRetry}
                className="rounded-lg border border-studio-border bg-white/5 px-3 py-2 text-xs font-medium text-studio-ink hover:bg-white/10 disabled:opacity-40"
                title="Retry with fresh trend research"
              >
                Retry
              </button>
              <button
                type="button"
                disabled={!hasCaptionText || isCaptionGenerating}
                onClick={() => setShowRevise((v) => !v)}
                className="rounded-lg border border-studio-border bg-white/5 px-3 py-2 text-xs font-medium text-studio-ink hover:bg-white/10 disabled:opacity-40"
              >
                Revise
              </button>
            </div>

            {showRevise && (
              <div className="space-y-2 rounded-lg border border-studio-border/80 bg-studio-canvas/40 p-2">
                <label className="block text-[10px] uppercase tracking-wide text-studio-mist">
                  Revise direction
                  <input
                    type="text"
                    value={reviseText}
                    onChange={(e) => setReviseText(e.target.value)}
                    placeholder="e.g. Shorter hook, more playful, add a soft CTA"
                    disabled={isCaptionGenerating}
                    className="mt-1 w-full rounded-lg border border-studio-border bg-studio-canvas/50 px-3 py-2 text-sm text-studio-ink placeholder:text-studio-mist/50 disabled:opacity-50"
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleReviseSubmit();
                      }
                    }}
                  />
                </label>
                <button
                  type="button"
                  disabled={isCaptionGenerating || !reviseText.trim()}
                  onClick={handleReviseSubmit}
                  className="rounded-lg bg-white/10 px-3 py-1.5 text-xs font-medium text-studio-ink hover:bg-white/15 disabled:opacity-40"
                >
                  Apply revise
                </button>
              </div>
            )}

            {captionProgressMessage && (
              <p className="text-[11px] text-pink-200">{captionProgressMessage}</p>
            )}
            {(isFallbackCaption || isFailedCaption) && (
              <p
                role="alert"
                className="rounded-md border border-amber-400/30 bg-amber-400/10 px-2.5 py-2 text-[11px] text-amber-100"
              >
                {isFailedCaption
                  ? captionPack?.generationError ||
                    'Caption generation failed. Retry before copying or publishing.'
                  : [
                      'Caption generation failed. The editable text below is a fallback, not an AI-grounded result. Retry before publishing if you need researched hashtags.',
                      captionPack?.generationError
                        ? `Details: ${captionPack.generationError}`
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' ')}
              </p>
            )}

            <label className="block text-[10px] uppercase tracking-wide text-studio-mist">
              Caption
              <span className="ml-1 normal-case text-studio-mist/60">(editable)</span>
              <textarea
                value={captionPack?.caption || ''}
                onChange={(e) => onCaptionChange({ caption: e.target.value, tone: selectedTone })}
                rows={5}
                placeholder="Generate a research-driven caption, or write your own…"
                className="mt-1 w-full resize-y rounded-lg border border-studio-border bg-studio-canvas/50 px-3 py-2 text-sm text-studio-ink placeholder:text-studio-mist/40"
              />
            </label>
            <label className="block text-[10px] uppercase tracking-wide text-studio-mist">
              Hashtags
              <textarea
                value={hashtagsText}
                onChange={(e) =>
                  onCaptionChange({
                    hashtags: e.target.value
                      .split(/\s+/)
                      .map((t) => t.replace(/^#/, ''))
                      .filter(Boolean),
                    tone: selectedTone,
                  })
                }
                rows={2}
                placeholder="#brand #product #timely"
                className="mt-1 w-full resize-y rounded-lg border border-studio-border bg-studio-canvas/50 px-3 py-2 text-sm text-studio-ink placeholder:text-studio-mist/40"
              />
            </label>
            {captionPack?.researchSummary && (
              <p
                className={`rounded-md border px-2.5 py-1.5 text-[10px] ${
                  isFallbackCaption || isFailedCaption
                    ? 'border-amber-400/30 bg-amber-400/10 text-amber-100'
                    : 'border-emerald-500/20 bg-emerald-500/10 text-emerald-100/90'
                }`}
              >
                {isFailedCaption ? 'Failed: ' : isFallbackCaption ? 'Fallback: ' : 'Research: '}
                {captionPack.researchSummary}
                {!isFallbackCaption &&
                  !isFailedCaption &&
                  (captionPack.usedWebResearch ? ' · live trends' : ' · studio context')}
              </p>
            )}
          </div>

          {statusMessage && (
            <p className="rounded-lg border border-studio-border bg-studio-canvas/40 px-3 py-2 text-xs text-studio-mist">
              {statusMessage}
            </p>
          )}

          <p className="text-[11px] text-studio-mist/90">
            Caption generate, edit, and copy work without Instagram tokens.
            {canLivePost
              ? ' Live Post is ready.'
              : ` Live Post needs IG Business tokens${igConfigured ? ' ✓' : ' (missing)'} and Supabase hosting${hostingConfigured ? ' ✓' : ' (missing)'}.`}
          </p>
        </div>

        <div className="flex flex-wrap gap-2 border-t border-studio-border px-4 py-3">
          <button
            type="button"
            disabled={!canUseCaption}
            onClick={handleCopyAll}
            className="rounded-lg border border-studio-border bg-white/5 px-3 py-2 text-xs font-medium text-studio-ink hover:bg-white/10 disabled:opacity-40"
          >
            {copied === 'all' ? 'Copied' : 'Copy caption + tags'}
          </button>
          <button
            type="button"
            disabled={!canUseCaption}
            onClick={handleCopyCaptionOnly}
            className="rounded-lg border border-studio-border bg-white/5 px-3 py-2 text-xs font-medium text-studio-ink hover:bg-white/10 disabled:opacity-40"
          >
            {copied === 'caption' ? 'Copied' : 'Copy caption'}
          </button>
          <button
            type="button"
            onClick={handleOpenInstagram}
            className="rounded-lg border border-studio-border bg-white/5 px-3 py-2 text-xs font-medium text-studio-ink hover:bg-white/10"
          >
            Open Instagram
          </button>
          <button
            type="button"
            disabled={slides.length === 0}
            onClick={onExportOrderedPack}
            className="rounded-lg border border-studio-border bg-white/5 px-3 py-2 text-xs font-medium text-studio-ink hover:bg-white/10 disabled:opacity-40"
          >
            Export ordered pack
          </button>
          <button
            type="button"
            disabled={!canLivePost || !canUseCaption || isPublishing}
            onClick={handlePublish}
            className="rounded-lg bg-gradient-to-r from-[#f09433] to-[#dc2743] px-3 py-2 text-xs font-semibold text-white disabled:opacity-40"
          >
            {isPublishing ? 'Publishing…' : 'Post to Instagram'}
          </button>
          <div className="flex-1" />
          <button
            type="button"
            onClick={onClearQueue}
            disabled={slides.length === 0}
            className="rounded-lg px-3 py-2 text-xs text-gray-400 hover:text-white disabled:opacity-40"
          >
            Clear queue
          </button>
        </div>
      </div>
    </div>
  );
};

export default InstagramPostPanel;

/** Exported for tests — maps tone labels without rendering. */
export function defaultViralTone(): CaptionTone {
  return 'viral';
}
