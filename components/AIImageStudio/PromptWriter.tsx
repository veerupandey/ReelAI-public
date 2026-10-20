import React, { useState, useCallback, useRef, useEffect } from 'react';
import type {
  AspectRatio,
  BrandKnowledge,
  ComposerReference,
  ProductTruth,
  StudioAsset,
  TrendResearchResult,
} from './types';
import {
  writePrompts,
  nextSlideCountAfterScreenshotChange,
  type PromptWriterResult,
  type PromptWriterSlide,
  type PromptWriterProgress,
  type PromptWriterInput,
} from './promptWriterService';
import { captureCarouselScreenshots, isScreenshotServerAvailable } from './screenshotService';
import {
  ASPECT_RATIO_OPTIONS,
  formatAspectRatioLabel,
  makeCustomAspectId,
  resolveAspectRatioOption,
} from './aspectRatioCatalog';

export interface PromptWriterSeed {
  instruction: string;
  slideCount?: number;
}

export interface PromptWriterProps {
  composerReferences: ComposerReference[];
  assets: StudioAsset[];
  aspectRatio: AspectRatio;
  brandKnowledge?: BrandKnowledge;
  productTruth?: ProductTruth;
  trendResearch?: TrendResearchResult;
  /** Shared session brand URL (editable; synced with Assistant / Import) */
  brandUrlInput?: string;
  onBrandUrlChange?: (text: string) => void;
  /** Let Writer change studio canvas (social, Amazon A+, custom WxH). */
  onAspectRatioChange?: (ratio: AspectRatio) => void;
  seed?: PromptWriterSeed | null;
  seedToken?: number;
  isOpen?: boolean;
  onApplyPrompt: (prompt: string, negativePrompt?: string) => void;
  onApplyAndGenerate: (prompt: string, negativePrompt?: string) => void;
  onGenerateAllSlides?: (slides: PromptWriterSlide[]) => void | Promise<void>;
  onClose: () => void;
}

const MAX_INSTRUCTION_LENGTH = 3000;

const PromptWriter: React.FC<PromptWriterProps> = ({
  composerReferences,
  assets,
  aspectRatio,
  brandKnowledge,
  productTruth,
  trendResearch,
  brandUrlInput = '',
  onBrandUrlChange,
  onAspectRatioChange,
  seed = null,
  seedToken = 0,
  isOpen = true,
  onApplyPrompt,
  onApplyAndGenerate,
  onGenerateAllSlides,
  onClose,
}) => {
  const [instruction, setInstruction] = useState(seed?.instruction ?? '');
  const [slideCount, setSlideCount] = useState(seed?.slideCount ?? 1);
  const [useWebSearch, setUseWebSearch] = useState(() => !(brandKnowledge || trendResearch));
  const [referenceUrl, setReferenceUrl] = useState('');
  const [refineText, setRefineText] = useState('');
  const [isWriting, setIsWriting] = useState(false);
  const [progress, setProgress] = useState<PromptWriterProgress | null>(null);
  const [result, setResult] = useState<PromptWriterResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expandedSlide, setExpandedSlide] = useState<number | null>(null);
  const [copiedSlide, setCopiedSlide] = useState<number | null>(null);
  const [isRefining, setIsRefining] = useState(false);
  const [copiedSection, setCopiedSection] = useState<string | null>(null);
  const [creativeStyle, setCreativeStyle] = useState('');
  const [creativeLighting, setCreativeLighting] = useState('');
  const [creativeMood, setCreativeMood] = useState('');
  const [creativeCamera, setCreativeCamera] = useState('');
  const [refScreenshots, setRefScreenshots] = useState<Array<{ base64: string; mimeType: string }>>([]);
  const screenshotInputRef = useRef<HTMLInputElement>(null);
  const [isCapturing, setIsCapturing] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const [serverAvailable, setServerAvailable] = useState<boolean | null>(null);
  const [isGeneratingAll, setIsGeneratingAll] = useState(false);
  const [customWidth, setCustomWidth] = useState(() => {
    const opt = resolveAspectRatioOption(aspectRatio);
    return String(opt.targetWidth || 1464);
  });
  const [customHeight, setCustomHeight] = useState(() => {
    const opt = resolveAspectRatioOption(aspectRatio);
    return String(opt.targetHeight || 600);
  });
  const wasOpenRef = useRef(false);
  const slideCountLockedRef = useRef(false);

  useEffect(() => {
    if (!seed || seedToken <= 0) return;
    // Fresh Assistant → Writer handoff: clear stale local Writer state.
    setInstruction(seed.instruction.slice(0, MAX_INSTRUCTION_LENGTH));
    setSlideCount(Math.min(10, Math.max(1, seed.slideCount ?? 1)));
    slideCountLockedRef.current = false;
    setReferenceUrl('');
    setRefScreenshots([]);
    setCreativeStyle('');
    setCreativeLighting('');
    setCreativeMood('');
    setCreativeCamera('');
    setCaptureError(null);
    setResult(null);
    setError(null);
    setIsRefining(false);
    setRefineText('');
    setExpandedSlide(null);
    // Avoid duplicate research after Assistant handoff; user can re-enable.
    setUseWebSearch(false);
  }, [seed, seedToken]);

  const slideCountRef = useRef(slideCount);
  useEffect(() => {
    slideCountRef.current = slideCount;
  }, [slideCount]);

  // When Writer opens with Assistant context already loaded, skip duplicate web research.
  useEffect(() => {
    const justOpened = isOpen && !wasOpenRef.current;
    wasOpenRef.current = isOpen;
    if (!justOpened) return;
    if (brandKnowledge || trendResearch) {
      setUseWebSearch(false);
    }
  }, [isOpen, brandKnowledge, trendResearch]);

  const hasRefs = composerReferences.length > 0;
  const hasBrand = !!brandKnowledge;
  const brandUrl =
    brandUrlInput.trim().split('\n').map((u) => u.trim()).filter(Boolean)[0] ||
    brandKnowledge?.sourceUrls?.[0];
  const hasAssistantContext = !!(brandKnowledge || productTruth || trendResearch);

  const refImages = composerReferences
    .map((ref) => {
      const asset = assets.find((a) => a.id === ref.assetId);
      if (!asset) return null;
      return { assetId: ref.assetId, role: ref.role, base64: asset.base64, mimeType: asset.mimeType };
    })
    .filter((r): r is { assetId: string; role: string; base64: string; mimeType: string } => r !== null);

  const buildInput = useCallback((): PromptWriterInput => {
    // Append creative control selections to instruction
    const creativeParts: string[] = [];
    if (creativeStyle) creativeParts.push(`Art style: ${creativeStyle}`);
    if (creativeLighting) creativeParts.push(`Lighting: ${creativeLighting}`);
    if (creativeMood) creativeParts.push(`Mood: ${creativeMood}`);
    if (creativeCamera) creativeParts.push(`Camera: ${creativeCamera}`);
    const enrichedInstruction = creativeParts.length > 0
      ? `${instruction}\n\nCreative direction:\n${creativeParts.join('\n')}`
      : instruction;

    const base: PromptWriterInput = {
      userInstruction: enrichedInstruction,
      brandKnowledge,
      productTruth,
      trendResearch,
      composerReferences,
      assets,
      aspectRatio,
      slideCount,
      useWebSearch,
      brandUrl,
      referenceUrl: referenceUrl.trim() || undefined,
      referenceScreenshots: refScreenshots.length > 0 ? refScreenshots : undefined,
    };
    if (isRefining && result && refineText.trim()) {
      base.refineInstruction = refineText.trim();
      base.previousSlides = result.slides;
    }
    return base;
  }, [instruction, creativeStyle, creativeLighting, creativeMood, creativeCamera, brandKnowledge, productTruth, trendResearch, composerReferences, assets, aspectRatio, slideCount, useWebSearch, brandUrl, referenceUrl, refScreenshots, isRefining, result, refineText]);

  const handleWrite = useCallback(async () => {
    if (!instruction.trim()) return;
    setIsWriting(true);
    setError(null);
    if (!isRefining) setResult(null);
    setExpandedSlide(null);

    try {
      const res = await writePrompts(buildInput(), (p) => setProgress(p));
      setResult(res);
      setExpandedSlide(0);
      setIsRefining(false);
      setRefineText('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Prompt writer failed. Please try again.');
    } finally {
      setIsWriting(false);
      setProgress(null);
    }
  }, [instruction, isRefining, buildInput]);

  const handleApply = useCallback(
    (slide: PromptWriterSlide) => {
      onApplyPrompt(slide.prompt, slide.negativePrompt);
      setCopiedSlide(slide.slideNumber);
      setTimeout(() => setCopiedSlide(null), 2000);
    },
    [onApplyPrompt],
  );

  const handleApplyAndGenerate = useCallback(
    (slide: PromptWriterSlide) => {
      onApplyAndGenerate(slide.prompt, slide.negativePrompt);
    },
    [onApplyAndGenerate],
  );

  const handleApplyFirst = useCallback(() => {
    if (!result?.slides[0]) return;
    handleApply(result.slides[0]);
  }, [result, handleApply]);

  const handleGenerateAll = useCallback(async () => {
    if (!result?.slides.length || !onGenerateAllSlides) return;
    setIsGeneratingAll(true);
    try {
      await onGenerateAllSlides(result.slides);
    } finally {
      setIsGeneratingAll(false);
    }
  }, [result, onGenerateAllSlides]);

  const handleCopySection = useCallback(async (text: string, id: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSection(id);
      setTimeout(() => setCopiedSection(null), 2000);
    } catch {
      // Fallback
    }
  }, []);

  const handleCopy = useCallback(async (slide: PromptWriterSlide) => {
    try {
      await navigator.clipboard.writeText(slide.prompt);
      setCopiedSlide(slide.slideNumber);
      setTimeout(() => setCopiedSlide(null), 2000);
    } catch {
      // Fallback
    }
  }, []);

  const handleCopyAll = useCallback(async () => {
    if (!result) return;
    const text = result.slides.map((s) =>
      `--- Slide ${s.slideNumber}: ${s.title} ---\n\nPROMPT:\n${s.prompt}\n\n${s.negativePrompt ? `NEGATIVE PROMPT:\n${s.negativePrompt}\n\n` : ''}COPY:\n${s.copy.headline || ''}\n${s.copy.supportingText || ''}\n${s.copy.caption || ''}\n\nDESIGN NOTES:\n${s.designNotes}\n${s.canvaText ? `\nCANVA TEXT:\nHeading: ${s.canvaText.heading || ''}\nSubtext: ${s.canvaText.subtext || ''}\nBody: ${s.canvaText.bodyText || ''}\nFooter: ${s.canvaText.footer || ''}\n` : ''}`
    ).join('\n\n========================================\n\n\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopiedSlide(-1);
      setTimeout(() => setCopiedSlide(null), 2000);
    } catch {
      // Fallback
    }
  }, [result]);

  const handleExport = useCallback(() => {
    if (!result) return;
    const text = result.slides.map((s) =>
      `--- Slide ${s.slideNumber}: ${s.title} ---\n\nPROMPT:\n${s.prompt}\n\n${s.negativePrompt ? `NEGATIVE PROMPT:\n${s.negativePrompt}\n\n` : ''}COPY:\n${s.copy.headline || ''}\n${s.copy.supportingText || ''}\n${s.copy.caption || ''}\n\nDESIGN NOTES:\n${s.designNotes}\n${s.canvaText ? `\nCANVA TEXT:\nHeading: ${s.canvaText.heading || ''}\nSubtext: ${s.canvaText.subtext || ''}\nBody: ${s.canvaText.bodyText || ''}\nFooter: ${s.canvaText.footer || ''}\n` : ''}`
    ).join('\n\n========================================\n\n\n');
    const blob = new Blob([text], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `prompt-writer-${slideCount}-slides-${Date.now()}.txt`;
    a.click();
    URL.revokeObjectURL(url);
  }, [result, slideCount]);

  const handleRefine = useCallback(() => {
    setIsRefining(true);
  }, []);

  const applyScreenshotChange = useCallback(
    (updater: (prev: Array<{ base64: string; mimeType: string }>) => Array<{ base64: string; mimeType: string }>) => {
      setRefScreenshots((prev) => {
        const next = updater(prev);
        const currentSlideCount = slideCountRef.current;
        const nextSlideCount = nextSlideCountAfterScreenshotChange({
          nextScreenshotCount: next.length,
          prevScreenshotCount: prev.length,
          currentSlideCount,
          userLocked: slideCountLockedRef.current,
        });
        if (nextSlideCount !== currentSlideCount) {
          setSlideCount(nextSlideCount);
        }
        return next;
      });
    },
    [],
  );

  const handleManualSlideCount = useCallback((next: number) => {
    slideCountLockedRef.current = true;
    setSlideCount(Math.min(10, Math.max(1, next)));
  }, []);

  const handleScreenshotUpload = useCallback(async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const newScreenshots: Array<{ base64: string; mimeType: string }> = [];
    for (const file of Array.from(files)) {
      if (!file.type.startsWith('image/')) continue;
      const base64 = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1]);
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
      newScreenshots.push({ base64, mimeType: file.type });
    }
    if (newScreenshots.length > 0) {
      applyScreenshotChange((prev) => [...prev, ...newScreenshots]);
    }
  }, [applyScreenshotChange]);

  const handleScreenshotPaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const pending: Array<Promise<{ base64: string; mimeType: string } | null>> = [];
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (!item.type.startsWith('image/')) continue;
      const file = item.getAsFile();
      if (!file) continue;
      pending.push(
        new Promise((resolve) => {
          const reader = new FileReader();
          reader.onload = () => {
            const result = reader.result as string;
            resolve({ base64: result.split(',')[1], mimeType: file.type });
          };
          reader.onerror = () => resolve(null);
          reader.readAsDataURL(file);
        }),
      );
    }
    if (pending.length === 0) return;
    e.preventDefault();
    void Promise.all(pending).then((shots) => {
      const valid = shots.filter((shot): shot is { base64: string; mimeType: string } => Boolean(shot));
      if (valid.length > 0) {
        applyScreenshotChange((prev) => [...prev, ...valid]);
      }
    });
  }, [applyScreenshotChange]);

  const removeScreenshot = useCallback((index: number) => {
    applyScreenshotChange((prev) => prev.filter((_, i) => i !== index));
  }, [applyScreenshotChange]);

  const handleAutoCapture = useCallback(async () => {
    const url = referenceUrl.trim();
    if (!url) return;
    setIsCapturing(true);
    setCaptureError(null);
    try {
      // Preflight so we fail fast with a clear shell message (same as Ad Creator capture).
      const available = await isScreenshotServerAvailable();
      setServerAvailable(available);
      if (!available) {
        throw new Error(
          'Agent shell server is not running (port 3721). Start it with npm run agent:server (or npm run dev:agent), then retry.',
        );
      }
      // Always crawl the full carousel (up to 10). Slide count syncs via applyScreenshotChange.
      const result = await captureCarouselScreenshots(url, 10);
      const newScreenshots = (result.screenshots || []).map((s) => ({
        base64: s.base64,
        mimeType: s.mimeType,
      }));
      if (newScreenshots.length === 0) {
        throw new Error(
          result.warning
          || 'No frames captured. The post may be private or blocked — upload screenshots manually instead.',
        );
      }
      applyScreenshotChange((prev) => [...prev, ...newScreenshots]);
      if (result.warning) {
        setCaptureError(result.warning);
      }
    } catch (err) {
      const raw = err instanceof Error ? err.message : 'Screenshot capture failed';
      const timedOut = /aborted|timeout|TimeoutError/i.test(raw);
      const shellDown = /shell server is not running|Failed to fetch|NetworkError|ECONNREFUSED/i.test(raw);
      setCaptureError(
        timedOut
          ? 'Capture timed out. Upload screenshots manually, or retry — Instagram embeds are sometimes slow.'
          : shellDown
            ? 'Cannot reach agent shell on 127.0.0.1:3721. Start it with npm run agent:server (or npm run dev:agent), then retry.'
            : raw,
      );
    } finally {
      setIsCapturing(false);
    }
  }, [referenceUrl, applyScreenshotChange]);

  const checkServerAvailability = useCallback(async () => {
    const available = await isScreenshotServerAvailable();
    setServerAvailable(available);
  }, []);

  // Detect shell when the Writer opens or a URL is pasted (not only on hover).
  useEffect(() => {
    if (!isOpen || !referenceUrl.trim()) return;
    void checkServerAvailability();
  }, [isOpen, referenceUrl, checkServerAvailability]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-studio-canvas/70"
      role="dialog"
      aria-label="AI Prompt Writer"
      aria-modal="true"
      onClick={onClose}
    >
      <div
        className="bg-studio-surface border border-studio-border rounded-t-2xl sm:rounded-2xl w-full sm:max-w-2xl max-h-[90vh] min-h-0 flex flex-col overflow-hidden shadow-2xl"
        onClick={(e) => e.stopPropagation()}
        onPaste={handleScreenshotPaste}
      >
        {/* Header */}
        <div className="flex-shrink-0 flex items-center justify-between px-5 pt-5 pb-3 border-b border-studio-border">
          <div className="flex items-center gap-2">
            <svg className="w-5 h-5 text-studio-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
            <h2 className="text-white font-semibold text-base">AI Prompt Writer</h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-5 py-4">
          {/* Context indicators */}
          <div className="flex flex-wrap gap-1.5 mb-3">
            <ContextChip label={`${composerReferences.length} locked`} active={hasRefs} />
            <ContextChip label="Brand" active={hasBrand} />
            <ContextChip label="Product truth" active={!!productTruth} />
            <ContextChip label="Trends" active={!!trendResearch} />
            <ContextChip label={`${refScreenshots.length} screenshot${refScreenshots.length !== 1 ? 's' : ''}`} active={refScreenshots.length > 0} />
            <ContextChip label={formatAspectRatioLabel(aspectRatio)} active />
          </div>

          {/* Canvas / aspect — social + Amazon A+ + custom */}
          {onAspectRatioChange && (
            <div className="mb-3 rounded-xl border border-studio-border/80 bg-studio-canvas/25 p-3 space-y-2.5">
              <div className="flex items-center justify-between gap-2">
                <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Canvas size</p>
                <p className="text-[10px] text-gray-600 truncate max-w-[60%]">
                  {resolveAspectRatioOption(aspectRatio).description
                    || resolveAspectRatioOption(aspectRatio).label}
                </p>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_RATIO_OPTIONS.filter((o) => o.group === 'social').map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isWriting}
                    onClick={() => onAspectRatioChange(opt.id)}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-medium border transition-colors ${
                      aspectRatio === opt.id
                        ? 'bg-studio-accent/20 text-teal-50 border-studio-accent/40'
                        : 'text-gray-400 border-studio-border hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {opt.shortLabel}
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap gap-1.5">
                {ASPECT_RATIO_OPTIONS.filter((o) => o.group === 'amazon').map((opt) => (
                  <button
                    key={opt.id}
                    type="button"
                    disabled={isWriting}
                    onClick={() => {
                      onAspectRatioChange(opt.id);
                      if (opt.targetWidth && opt.targetHeight) {
                        setCustomWidth(String(opt.targetWidth));
                        setCustomHeight(String(opt.targetHeight));
                      }
                    }}
                    title={opt.description}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors text-left ${
                      aspectRatio === opt.id
                        ? 'bg-amber-500/15 text-amber-50 border-amber-400/40'
                        : 'text-gray-400 border-studio-border hover:text-white hover:bg-white/5'
                    }`}
                  >
                    <span className="font-semibold">{opt.shortLabel}</span>
                    <span className="block text-[9px] text-gray-500 mt-0.5">
                      {opt.targetWidth}×{opt.targetHeight} min
                    </span>
                  </button>
                ))}
              </div>
              <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-white/5">
                <label className="space-y-1">
                  <span className="block text-[10px] text-gray-500">Custom width</span>
                  <input
                    type="number"
                    min={64}
                    max={8192}
                    value={customWidth}
                    disabled={isWriting}
                    onChange={(e) => setCustomWidth(e.target.value)}
                    className="w-[5.5rem] rounded-lg border border-studio-border bg-studio-canvas/50 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent/50"
                  />
                </label>
                <span className="text-gray-600 pb-2">×</span>
                <label className="space-y-1">
                  <span className="block text-[10px] text-gray-500">Height</span>
                  <input
                    type="number"
                    min={64}
                    max={8192}
                    value={customHeight}
                    disabled={isWriting}
                    onChange={(e) => setCustomHeight(e.target.value)}
                    className="w-[5.5rem] rounded-lg border border-studio-border bg-studio-canvas/50 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent/50"
                  />
                </label>
                <button
                  type="button"
                  disabled={isWriting}
                  onClick={() => {
                    const w = Number(customWidth);
                    const h = Number(customHeight);
                    if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64) return;
                    onAspectRatioChange(makeCustomAspectId(w, h));
                  }}
                  className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-white/8 text-gray-200 border border-studio-border hover:bg-white/12"
                >
                  Apply custom
                </button>
              </div>
            </div>
          )}

          {hasAssistantContext && (
            <div className="mb-3 rounded-lg border border-emerald-500/20 bg-emerald-500/10 px-3 py-2 text-[11px] text-emerald-200">
              Using Creative Assistant context (brand, product, trends)
              {!useWebSearch ? ' — web research off to avoid duplicate research.' : '.'}
              {' '}You can turn web research back on below.
            </div>
          )}

          {hasRefs && (
            <div className="mb-3 rounded-lg border border-studio-accent/20 bg-studio-accent/10 px-3 py-2 text-[11px] text-teal-50">
              {composerReferences.length} locked image{composerReferences.length === 1 ? '' : 's'} will be analyzed as product references.
            </div>
          )}

          {seed && seedToken > 0 && instruction.trim().startsWith('Concept:') && (
            <div className="mb-3 rounded-lg border border-studio-accent/25 bg-studio-accent/10 px-3 py-2 text-[11px] text-teal-50">
              Pre-filled from a selected concept. Adjust slide count for carousels, then write prompts.
            </div>
          )}

          {/* Reference image thumbnails */}
          {refImages.length > 0 && (
            <div className="flex gap-2 mb-3 overflow-x-auto pb-1">
              {refImages.map((ref) => (
                <div key={ref.assetId} className="relative flex-shrink-0 group">
                  <img
                    src={`data:${ref.mimeType};base64,${ref.base64}`}
                    alt="Reference"
                    className="w-14 h-14 rounded-lg object-cover border border-studio-border"
                  />
                  <span className="absolute -bottom-1 -right-1 px-1 py-0.5 rounded text-[8px] font-bold uppercase bg-studio-surface border border-studio-border text-gray-400">
                    {ref.role}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Quick presets */}
          {!result && !isWriting && (
            <div className="flex flex-wrap gap-1.5 mb-3">
              {PRESETS.map((preset) => (
                <button
                  key={preset.label}
                  type="button"
                  onClick={() => setInstruction(preset.text)}
                  className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-white/5 border border-studio-border text-gray-400 hover:text-teal-200 hover:border-studio-accent/40 hover:bg-studio-accent/10 transition-colors"
                >
                  {preset.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => {
                  const randomStyle = STYLE_OPTIONS[Math.floor(Math.random() * STYLE_OPTIONS.length)];
                  const randomLighting = LIGHTING_OPTIONS[Math.floor(Math.random() * LIGHTING_OPTIONS.length)];
                  const randomMood = MOOD_OPTIONS[Math.floor(Math.random() * MOOD_OPTIONS.length)];
                  const randomCamera = CAMERA_OPTIONS[Math.floor(Math.random() * CAMERA_OPTIONS.length)];
                  setInstruction(`Create a ${randomMood.label.toLowerCase()} product scene with ${randomLighting.label.toLowerCase()}. ${randomStyle.label} style, ${randomCamera.label.toLowerCase()}. Make it feel premium and on-brand.`);
                }}
                className="px-2.5 py-1 rounded-full text-[11px] font-medium bg-studio-accent/10 border border-studio-accent/30 text-teal-200 hover:bg-studio-accent/20 transition-colors flex items-center gap-1"
              >
                <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M16.023 9.348h4.992v-.001M2.985 19.644v-4.992m0 0h4.992m-4.993 0l3.181 3.183a8.25 8.25 0 0013.803-3.7M4.031 9.865a8.25 8.25 0 0113.803-3.7l3.181 3.182m0-4.991v4.99" /></svg>
                Inspire me
              </button>
            </div>
          )}

          {/* Creative controls — quick-pick dropdowns */}
          {!result && !isWriting && (
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-3">
              <CreativeSelect
                label="Style"
                value={creativeStyle}
                onChange={setCreativeStyle}
                options={STYLE_OPTIONS}
              />
              <CreativeSelect
                label="Lighting"
                value={creativeLighting}
                onChange={setCreativeLighting}
                options={LIGHTING_OPTIONS}
              />
              <CreativeSelect
                label="Mood"
                value={creativeMood}
                onChange={setCreativeMood}
                options={MOOD_OPTIONS}
              />
              <CreativeSelect
                label="Camera"
                value={creativeCamera}
                onChange={setCreativeCamera}
                options={CAMERA_OPTIONS}
              />
            </div>
          )}

          {/* Instruction input */}
          <div className="mb-4">
            <label
              htmlFor="pw-instruction"
              className="block text-xs uppercase tracking-widest text-gray-400 font-semibold mb-2"
            >
              What do you want to create?
            </label>
            <textarea
              id="pw-instruction"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value.slice(0, MAX_INSTRUCTION_LENGTH))}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter' && !isWriting && instruction.trim()) {
                  handleWrite();
                }
              }}
              disabled={isWriting}
              placeholder="e.g. Recreate this carousel for Kageha — matcha pairing guide with sweeteners. Change the illustration style and copy so it feels original. Use the brand's premium, calm aesthetic from kageha.ca. Upload screenshots of the reference post above for best results."
              rows={4}
              className="w-full px-3 py-2.5 bg-white/5 border border-studio-border rounded-lg text-white text-sm placeholder-gray-500 resize-y focus:outline-none focus:ring-2 focus:ring-studio-accent focus:border-transparent disabled:opacity-50 min-h-[100px]"
            />
            <div className="flex justify-end mt-1">
              <span className="text-[10px] text-gray-600">{instruction.length}/{MAX_INSTRUCTION_LENGTH}</span>
            </div>
          </div>

          {/* URL inputs */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mb-4">
            {/* Brand URL */}
            <div>
              <label htmlFor="pw-brand-url" className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
                Brand URL {hasBrand && <span className="text-emerald-400 normal-case">(loaded)</span>}
              </label>
              <input
                id="pw-brand-url"
                type="url"
                value={brandUrlInput}
                onChange={(e) => onBrandUrlChange?.(e.target.value)}
                disabled={isWriting}
                placeholder="https://kageha.ca"
                className="w-full px-3 py-2 bg-white/5 border border-studio-border rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-studio-accent focus:border-transparent disabled:opacity-50"
              />
              <p className="mt-1 text-[9px] text-gray-600">
                Shared with Creative Assistant &amp; Import — edit anytime.
              </p>
            </div>
            {/* Reference URL */}
            <div>
              <label htmlFor="pw-ref-url" className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
                Reference post URL
              </label>
              <input
                id="pw-ref-url"
                type="url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                disabled={isWriting}
                placeholder="https://instagram.com/p/..."
                className="w-full px-3 py-2 bg-white/5 border border-studio-border rounded-lg text-white text-xs placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-studio-accent focus:border-transparent disabled:opacity-50"
              />
            </div>
          </div>

          {/* Reference post screenshots */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2">
              <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
                Reference post screenshots
                {refScreenshots.length > 0 && <span className="text-emerald-400 normal-case ml-1">({refScreenshots.length} loaded)</span>}
              </label>
              <div className="flex items-center gap-2">
                {refScreenshots.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setRefScreenshots([])}
                    disabled={isWriting}
                    className="text-[10px] text-gray-500 hover:text-red-400 transition-colors"
                  >
                    Clear all
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => screenshotInputRef.current?.click()}
                  disabled={isWriting}
                  className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-studio-accent/10 border border-studio-accent/30 text-teal-200 hover:bg-studio-accent/20 transition-colors disabled:opacity-50"
                >
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                  </svg>
                  Upload screenshots
                </button>
                {referenceUrl.trim() && (
                  <button
                    type="button"
                    onClick={handleAutoCapture}
                    disabled={isWriting || isCapturing}
                    onMouseEnter={checkServerAvailability}
                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[11px] font-medium bg-blue-500/10 border border-blue-500/30 text-blue-300 hover:bg-blue-500/20 transition-colors disabled:opacity-50"
                  >
                    {isCapturing ? (
                      <>
                        <svg className="w-3 h-3 animate-spin" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                        </svg>
                        Capturing Instagram…
                      </>
                    ) : (
                      <>
                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                          <path strokeLinecap="round" strokeLinejoin="round" d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z" />
                          <path strokeLinecap="round" strokeLinejoin="round" d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
                        </svg>
                        Auto-capture from URL
                      </>
                    )}
                  </button>
                )}
                <input
                  ref={screenshotInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  className="hidden"
                  onChange={(e) => {
                    handleScreenshotUpload(e.target.files);
                    if (e.target.value) e.target.value = '';
                  }}
                />
              </div>
            </div>
            {isCapturing && (
              <div className="text-[11px] text-blue-300/90 bg-blue-500/10 border border-blue-500/20 rounded-lg px-3 py-2 mb-2">
                Loading Instagram embed and grabbing slides (usually a few seconds). You can also upload screenshots anytime.
              </div>
            )}
            {captureError && (
              <div className="text-[11px] text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2 mb-2">
                {captureError}
              </div>
            )}
            {refScreenshots.length === 0 ? (
              <div className="text-[11px] text-gray-600 bg-white/5 border border-studio-border rounded-lg px-3 py-2.5">
                Upload or paste (Ctrl+V) screenshots of the reference post carousel. The AI will analyze each slide's layout, copy, and structure to recreate it for your brand.
                {referenceUrl.trim() && <span className="block mt-1 text-blue-400/70">Tip: Click "Auto-capture from URL" to pull slides via the agent shell (127.0.0.1:3721). {serverAvailable === false && <span className="text-yellow-500/70">Shell server not detected — start with npm run agent:server (or npm run dev:agent).</span>}</span>}
              </div>
            ) : (
              <div className="flex gap-2 overflow-x-auto pb-1">
                {refScreenshots.map((screenshot, idx) => (
                  <div key={idx} className="relative flex-shrink-0 group">
                    <img
                      src={`data:${screenshot.mimeType};base64,${screenshot.base64}`}
                      alt={`Reference slide ${idx + 1}`}
                      className="w-20 h-28 rounded-lg object-cover border border-studio-border"
                    />
                    <span className="absolute top-1 left-1 px-1 py-0.5 rounded text-[8px] font-bold bg-studio-canvas/70 text-white">
                      {idx + 1}
                    </span>
                    <button
                      type="button"
                      onClick={() => removeScreenshot(idx)}
                      disabled={isWriting}
                      className="absolute -top-1 -right-1 w-5 h-5 rounded-full bg-red-500/80 text-white flex items-center justify-center text-[10px] hover:bg-red-500 transition-colors opacity-0 group-hover:opacity-100"
                    >
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Options row */}
          <div className="flex flex-wrap items-center gap-4 mb-4">
            {/* Slide count */}
            <div className="flex items-center gap-2">
              <label className="text-xs uppercase tracking-widest text-gray-400 font-semibold">Slides</label>
              <div className="flex items-center bg-white/5 border border-studio-border rounded-lg overflow-hidden">
                <button
                  type="button"
                  onClick={() => handleManualSlideCount(slideCount - 1)}
                  disabled={isWriting || slideCount <= 1}
                  className="px-2.5 py-1.5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M20 12H4" />
                  </svg>
                </button>
                <span className="px-3 text-sm text-white font-semibold min-w-[2rem] text-center">{slideCount}</span>
                <button
                  type="button"
                  onClick={() => handleManualSlideCount(slideCount + 1)}
                  disabled={isWriting || slideCount >= 10}
                  className="px-2.5 py-1.5 text-gray-400 hover:text-white hover:bg-white/10 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                </button>
              </div>
              <span className="text-[10px] text-gray-600">{slideCount === 1 ? 'single image' : 'carousel'}</span>
              {refScreenshots.length > 0 && refScreenshots.length !== slideCount && (
                <button
                  type="button"
                  onClick={() => {
                    slideCountLockedRef.current = false;
                    setSlideCount(Math.min(10, Math.max(1, refScreenshots.length)));
                  }}
                  className="text-[10px] text-amber-300 hover:text-amber-200 underline underline-offset-2"
                  title="Match slide count to the number of reference screenshots"
                >
                  Match {refScreenshots.length} screenshots
                </button>
              )}
            </div>

            {/* Web search toggle */}
            <button
              type="button"
              onClick={() => setUseWebSearch((v) => !v)}
              disabled={isWriting}
              className="flex items-center gap-2 px-3 py-1.5 rounded-lg border text-xs transition-all focus:outline-none focus:ring-2 focus:ring-studio-accent/50 disabled:opacity-50"
              aria-pressed={useWebSearch}
              style={{
                borderColor: useWebSearch ? 'rgba(46,184,166,0.55)' : '#2f5a68',
                background: useWebSearch ? 'rgba(46,184,166,0.14)' : 'transparent',
                color: useWebSearch ? '#d8b4fe' : '#9ca3af',
              }}
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
              </svg>
              Web research{hasAssistantContext && !useWebSearch ? ' (optional)' : ''}
            </button>
          </div>

          {/* Generate / Refine button */}
          {isRefining ? (
            <div className="mb-4">
              <label htmlFor="pw-refine" className="block text-xs uppercase tracking-widest text-gray-400 font-semibold mb-2">
                Refinement instruction
              </label>
              <div className="flex gap-2">
                <input
                  id="pw-refine"
                  type="text"
                  value={refineText}
                  onChange={(e) => setRefineText(e.target.value)}
                  disabled={isWriting}
                  placeholder="e.g. Make slide 2 more minimal, warmer palette on all slides"
                  className="flex-1 px-3 py-2.5 bg-white/5 border border-studio-border rounded-lg text-white text-sm placeholder-gray-500 focus:outline-none focus:ring-2 focus:ring-studio-accent focus:border-transparent disabled:opacity-50"
                  onKeyDown={(e) => { if (e.key === 'Enter' && refineText.trim() && !isWriting) handleWrite(); }}
                />
                <button
                  type="button"
                  onClick={() => { setIsRefining(false); setRefineText(''); }}
                  disabled={isWriting}
                  className="px-3 py-2.5 rounded-lg text-gray-400 hover:text-white hover:bg-white/5 text-xs font-medium transition-colors disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
              <button
                type="button"
                onClick={handleWrite}
                disabled={!refineText.trim() || isWriting}
                className="w-full flex items-center justify-center gap-2 px-4 py-3 mt-2 rounded-lg bg-gradient-to-r from-studio-accent to-studio-accent-strong text-white text-sm font-bold hover:shadow-lg hover:shadow-studio-accent/25 transition-all focus:outline-none focus:ring-2 focus:ring-studio-accent disabled:opacity-40 disabled:cursor-not-allowed"
              >
                {isWriting ? (
                  <><Spinner /><span>{progress?.message || 'Refining...'}</span></>
                ) : (
                  <><svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg><span>Refine prompts</span></>
                )}
              </button>
            </div>
          ) : (
            <button
              type="button"
              onClick={handleWrite}
              disabled={!instruction.trim() || isWriting}
              className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg bg-gradient-to-r from-studio-accent to-studio-accent-strong text-white text-sm font-bold hover:shadow-lg hover:shadow-studio-accent/25 transition-all focus:outline-none focus:ring-2 focus:ring-studio-accent disabled:opacity-40 disabled:cursor-not-allowed mb-4"
            >
              {isWriting ? (
                <>
                  <Spinner />
                  <span>{progress?.message || 'Working...'}</span>
                </>
              ) : (
                <>
                  <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                  </svg>
                  <span>Write {slideCount > 1 ? `${slideCount} prompts` : 'prompt'}</span>
                </>
              )}
            </button>
          )}

          {/* Progress bar */}
          {isWriting && progress && (
            <div className="mb-4">
              <div className="h-1 bg-white/5 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-studio-accent to-teal-300 transition-all duration-500"
                  style={{ width: `${progress.progressPercent}%` }}
                />
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mb-4 px-4 py-3 rounded-lg bg-red-500/10 border border-red-500/30 text-sm text-red-300">
              {error}
            </div>
          )}

          {/* Empty state */}
          {!result && !isWriting && !error && (
            <div className="px-4 py-6 rounded-lg bg-white/3 border border-studio-border/50 text-center">
              <svg className="w-10 h-10 mx-auto mb-3 text-gray-600" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <p className="text-sm text-gray-400 font-medium mb-1">Write world-class prompts in seconds</p>
              <p className="text-xs text-gray-600 leading-relaxed">
                Describe what you want, pick a preset, or paste a reference URL.<br />
                The Writer uses your brand, product, and trends to craft detailed prompts.
              </p>
              <div className="flex items-center justify-center gap-1.5 mt-3 text-[10px] text-gray-600">
                <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-studio-border font-mono">⌘</kbd>
                <kbd className="px-1.5 py-0.5 rounded bg-white/5 border border-studio-border font-mono">↵</kbd>
                <span>to write</span>
              </div>
            </div>
          )}

          {/* Results */}
          {result && (
            <div className="flex flex-col gap-3">
              {/* Creative direction summary */}
              {result.creativeDirection && (
                <div className="px-4 py-3 rounded-lg bg-studio-accent/10 border border-studio-accent/30">
                  <p className="text-[10px] uppercase tracking-widest text-teal-200 font-semibold mb-1">Creative direction</p>
                  <p className="text-xs text-gray-300">{result.creativeDirection}</p>
                </div>
              )}

              {/* Reference analysis */}
              {result.referenceAnalysis && (
                <div className="px-4 py-3 rounded-lg bg-blue-500/10 border border-blue-500/20">
                  <p className="text-[10px] uppercase tracking-widest text-blue-300 font-semibold mb-1">Reference analysis</p>
                  <p className="text-xs text-gray-300 whitespace-pre-wrap">{result.referenceAnalysis}</p>
                </div>
              )}

              {/* Research summary */}
              {result.researchSummary && (
                <div className="px-4 py-3 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
                  <p className="text-[10px] uppercase tracking-widest text-emerald-300 font-semibold mb-1">Research summary</p>
                  <p className="text-xs text-gray-300">{result.researchSummary}</p>
                  {result.sources.length > 0 && (
                    <div className="flex flex-wrap gap-1 mt-2">
                      {result.sources.slice(0, 5).map((src) => (
                        <a
                          key={src.id}
                          href={src.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[10px] text-emerald-400 hover:text-emerald-300 underline truncate max-w-[150px]"
                        >
                          {src.label}
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Bulk actions */}
              <div className="flex flex-wrap gap-2">
                {result.slides.length > 0 && (
                  <button
                    type="button"
                    onClick={handleApplyFirst}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-studio-border text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
                  >
                    Apply first to composer
                  </button>
                )}
                {onGenerateAllSlides && result.slides.length > 1 && (
                  <button
                    type="button"
                    onClick={handleGenerateAll}
                    disabled={isWriting || isGeneratingAll}
                    className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-studio-accent to-studio-accent-strong text-white text-xs font-bold hover:shadow-lg hover:shadow-studio-accent/25 transition-all focus:outline-none focus:ring-2 focus:ring-studio-accent disabled:opacity-50"
                  >
                    {isGeneratingAll ? 'Generating slides…' : `Generate all ${result.slides.length} slides`}
                  </button>
                )}
                <button
                  type="button"
                  onClick={handleCopyAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-studio-border text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  {copiedSlide === -1 ? (
                    <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Copied all!</>
                  ) : (
                    <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" /></svg>Copy all</>
                  )}
                </button>
                <button
                  type="button"
                  onClick={handleExport}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-studio-border text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" /></svg>
                  Export .txt
                </button>
                <button
                  type="button"
                  onClick={handleRefine}
                  disabled={isWriting || isGeneratingAll}
                  className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-studio-border text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20 disabled:opacity-50"
                >
                  <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" /></svg>
                  Refine
                </button>
              </div>

              {/* Follow-up suggestions */}
              {!isWriting && (
                <div className="flex flex-wrap gap-1.5">
                  <span className="text-[10px] text-gray-600 self-center mr-1">Try:</span>
                  {FOLLOW_UP_SUGGESTIONS.map((sug) => (
                    <button
                      key={sug.label}
                      type="button"
                      onClick={() => {
                        setRefineText(sug.text);
                        setIsRefining(true);
                      }}
                      className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-white/5 border border-studio-border text-gray-400 hover:text-teal-200 hover:border-studio-accent/40 hover:bg-studio-accent/10 transition-colors"
                    >
                      {sug.label}
                    </button>
                  ))}
                </div>
              )}

              {/* Slides */}
              {result.slides.map((slide, idx) => (
                <div
                  key={slide.slideNumber}
                  className="rounded-lg border border-studio-border bg-white/3 overflow-hidden"
                >
                  {/* Slide header */}
                  <button
                    type="button"
                    onClick={() => setExpandedSlide(expandedSlide === idx ? null : idx)}
                    className="w-full flex items-center justify-between px-4 py-3 text-left hover:bg-white/5 transition-colors focus:outline-none"
                  >
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="flex-shrink-0 w-6 h-6 rounded-full bg-studio-accent/20 text-teal-200 text-[10px] font-bold flex items-center justify-center">
                        {slide.slideNumber}
                      </span>
                      <span className="text-sm text-white font-medium truncate">{slide.title}</span>
                    </div>
                    <svg
                      className={`flex-shrink-0 w-4 h-4 text-gray-400 transition-transform ${expandedSlide === idx ? 'rotate-180' : ''}`}
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                      strokeWidth={2}
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Slide content */}
                  {expandedSlide === idx && (
                    <div className="px-4 pb-4 border-t border-studio-border pt-3 flex flex-col gap-3">
                      {/* Copy */}
                      {(slide.copy.headline || slide.copy.supportingText) && (
                        <div className="flex flex-col gap-1">
                          {slide.copy.headline && (
                            <p className="text-sm text-white font-semibold">{slide.copy.headline}</p>
                          )}
                          {slide.copy.supportingText && (
                            <p className="text-xs text-gray-400">{slide.copy.supportingText}</p>
                          )}
                        </div>
                      )}

                      {/* Prompt */}
                      <div>
                        <div className="flex items-center justify-between mb-1.5">
                          <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Prompt</p>
                          <button
                            type="button"
                            onClick={() => handleCopySection(slide.prompt, `prompt-${slide.slideNumber}`)}
                            className="text-[10px] text-gray-500 hover:text-teal-200 transition-colors flex items-center gap-1"
                          >
                            {copiedSection === `prompt-${slide.slideNumber}` ? '✓ Copied' : 'Copy'}
                          </button>
                        </div>
                        <div className="max-h-[250px] overflow-y-auto">
                          <p className="text-xs text-gray-300 whitespace-pre-wrap leading-relaxed">{slide.prompt}</p>
                        </div>
                      </div>

                      {/* Negative prompt */}
                      {slide.negativePrompt && (
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-red-400/70 font-semibold mb-1">Negative prompt</p>
                          <p className="text-xs text-red-300/80 italic">{slide.negativePrompt}</p>
                        </div>
                      )}

                      {/* Design notes */}
                      {slide.designNotes && (
                        <div>
                          <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1">Design notes</p>
                          <p className="text-xs text-gray-400 italic">{slide.designNotes}</p>
                        </div>
                      )}

                      {/* Canva text */}
                      {slide.canvaText && (slide.canvaText.heading || slide.canvaText.subtext || slide.canvaText.bodyText || slide.canvaText.footer) && (
                        <div className="px-3 py-2 rounded-lg bg-white/5 border border-studio-border/50">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Canva text (for manual design)</p>
                            <button
                              type="button"
                              onClick={() => {
                                const canvaStr = [slide.canvaText!.heading, slide.canvaText!.subtext, slide.canvaText!.bodyText, slide.canvaText!.footer].filter(Boolean).join('\n');
                                handleCopySection(canvaStr, `canva-${slide.slideNumber}`);
                              }}
                              className="text-[10px] text-gray-500 hover:text-teal-200 transition-colors"
                            >
                              {copiedSection === `canva-${slide.slideNumber}` ? '✓ Copied' : 'Copy'}
                            </button>
                          </div>
                          <div className="flex flex-col gap-0.5">
                            {slide.canvaText.heading && <p className="text-xs text-white font-semibold">{slide.canvaText.heading}</p>}
                            {slide.canvaText.subtext && <p className="text-xs text-gray-300">{slide.canvaText.subtext}</p>}
                            {slide.canvaText.bodyText && <p className="text-xs text-gray-400 whitespace-pre-wrap">{slide.canvaText.bodyText}</p>}
                            {slide.canvaText.footer && <p className="text-[10px] text-gray-500">{slide.canvaText.footer}</p>}
                          </div>
                        </div>
                      )}

                      {/* Actions */}
                      <div className="flex gap-2 pt-1">
                        <button
                          type="button"
                          onClick={() => handleApplyAndGenerate(slide)}
                          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-gradient-to-r from-studio-accent to-studio-accent-strong text-white text-xs font-bold hover:shadow-lg hover:shadow-studio-accent/25 transition-all focus:outline-none focus:ring-2 focus:ring-studio-accent"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M13 10V3L4 14h7v7l9-11h-7z" />
                          </svg>
                          Apply & Generate
                        </button>
                        <button
                          type="button"
                          onClick={() => handleApply(slide)}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-studio-border text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
                          title="Apply to composer without generating"
                        >
                          {copiedSlide === slide.slideNumber ? (
                            <><svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}><path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" /></svg>Applied!</>
                          ) : (
                            'Apply only'
                          )}
                        </button>
                        <button
                          type="button"
                          onClick={() => handleCopy(slide)}
                          className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg bg-white/5 border border-studio-border text-gray-300 hover:text-white hover:bg-white/10 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
                          title="Copy prompt to clipboard"
                        >
                          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                            <path strokeLinecap="round" strokeLinejoin="round" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 px-5 py-4 border-t border-studio-border flex gap-3">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2.5 rounded-lg text-gray-300 hover:text-white hover:bg-white/5 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-white/20"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};

// --- Helpers ---

const ContextChip: React.FC<{ label: string; active: boolean }> = ({ label, active }) => (
  <span
    className={`px-2 py-0.5 rounded-full text-[10px] font-medium border ${
      active
        ? 'bg-studio-accent/15 border-studio-accent/40 text-teal-200'
        : 'bg-white/3 border-studio-border text-gray-600'
    }`}
  >
    {label}
  </span>
);

const Spinner: React.FC = () => (
  <svg
    className="animate-spin h-4 w-4"
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
  </svg>
);

const PRESETS = [
  { label: 'Recreate carousel', text: 'Recreate this reference carousel for my product. Keep the educational structure and flow but change the visual style, illustrations, and copy to feel original and on-brand. Use my product images as the hero.' },
  { label: 'Product hero shot', text: 'Create a premium product hero shot. The product should be the focal point, placed in a beautiful environment that tells the product story. Studio-quality lighting, shallow depth of field, aspirational mood.' },
  { label: 'Lifestyle scene', text: 'Create a lifestyle scene showing the product in real-world use. Natural lighting, authentic setting, the product should feel organically placed — not staged. Show the experience of using the product.' },
  { label: 'Before/after', text: 'Create a before/after comparison visual. Left side shows the problem, right side shows the transformation with the product. Clean, minimal, with clear visual hierarchy.' },
  { label: 'Ingredient story', text: 'Create a visual that tells the ingredient story. Show the key ingredients around the product with beautiful natural styling. Educational, premium, and appetizing.' },
];

const FOLLOW_UP_SUGGESTIONS = [
  { label: 'Warmer lighting', text: 'Make the lighting warmer and more inviting — golden hour tones' },
  { label: 'Overhead angle', text: 'Switch to an overhead top-down flat lay angle' },
  { label: 'More minimal', text: 'Make it more minimal — fewer props, cleaner background, more negative space' },
  { label: 'Add motion', text: 'Add a sense of motion — pouring, splashing, or dynamic action' },
  { label: 'Cozy mood', text: 'Make the mood cozier — warm tones, soft textures, intimate framing' },
  { label: 'Bold colors', text: 'Make the colors bolder and more vibrant — punchy, high-contrast' },
];

const STYLE_OPTIONS = [
  { label: 'Photorealistic', value: 'photorealistic' },
  { label: 'Cinematic', value: 'cinematic' },
  { label: 'Editorial photography', value: 'editorial photography' },
  { label: 'Product photography', value: 'product photography' },
  { label: 'Food photography', value: 'food photography' },
  { label: 'Lifestyle photography', value: 'lifestyle photography' },
  { label: 'Minimalist', value: 'minimalist' },
  { label: '3D render', value: '3d render' },
  { label: 'Illustration', value: 'illustration' },
  { label: 'Watercolor', value: 'watercolor' },
  { label: 'Digital art', value: 'digital art' },
  { label: 'Vintage / Retro', value: 'vintage retro' },
];

const LIGHTING_OPTIONS = [
  { label: 'Golden hour', value: 'golden hour' },
  { label: 'Soft natural', value: 'soft natural light' },
  { label: 'Studio lighting', value: 'studio lighting' },
  { label: 'Dramatic', value: 'dramatic lighting' },
  { label: 'Backlit / Rim', value: 'backlit rim light' },
  { label: 'Soft diffused', value: 'soft diffused light' },
  { label: 'Neon', value: 'neon lighting' },
  { label: 'Cinematic', value: 'cinematic lighting' },
  { label: 'High-key bright', value: 'high key bright lighting' },
  { label: 'Low-key moody', value: 'low key moody lighting' },
];

const MOOD_OPTIONS = [
  { label: 'Warm & inviting', value: 'warm and inviting' },
  { label: 'Serene & peaceful', value: 'serene and peaceful' },
  { label: 'Elegant & luxurious', value: 'elegant and luxurious' },
  { label: 'Bright & cheerful', value: 'bright and cheerful' },
  { label: 'Dramatic & intense', value: 'dramatic and intense' },
  { label: 'Ethereal & dreamy', value: 'ethereal and dreamy' },
  { label: 'Bold & vibrant', value: 'bold and vibrant' },
  { label: 'Nostalgic & vintage', value: 'nostalgic and vintage' },
  { label: 'Cozy & comfortable', value: 'cozy and comfortable' },
  { label: 'Fresh & natural', value: 'fresh and natural' },
];

const CAMERA_OPTIONS = [
  { label: 'Close-up', value: 'close-up shot' },
  { label: 'Macro', value: 'macro shot' },
  { label: 'Wide angle', value: 'wide angle shot' },
  { label: 'Eye level', value: 'eye level shot' },
  { label: 'Low angle', value: 'low angle shot' },
  { label: 'High angle', value: 'high angle shot' },
  { label: "Bird's eye", value: 'birds eye view' },
  { label: 'Dutch angle', value: 'dutch angle' },
  { label: '35mm lens', value: '35mm lens' },
  { label: '85mm portrait', value: '85mm portrait lens' },
  { label: 'Shallow DOF', value: 'shallow depth of field bokeh' },
  { label: 'Top-down flat lay', value: 'top-down flat lay' },
];

const CreativeSelect: React.FC<{
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { label: string; value: string }[];
}> = ({ label, value, onChange, options }) => (
  <div className="relative">
    <label className="block text-[9px] uppercase tracking-widest text-gray-500 font-semibold mb-1">{label}</label>
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="w-full px-2 py-1.5 bg-white/5 border border-studio-border rounded-md text-xs text-gray-300 focus:outline-none focus:ring-1 focus:ring-studio-accent focus:border-transparent cursor-pointer appearance-none disabled:opacity-50"
      style={{
        backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 24 24' stroke='%23666' stroke-width='2'%3E%3Cpath stroke-linecap='round' stroke-linejoin='round' d='M19 9l-7 7-7-7'/%3E%3C/svg%3E")`,
        backgroundRepeat: 'no-repeat',
        backgroundPosition: 'right 4px center',
        backgroundSize: '14px',
        paddingRight: '20px',
      }}
    >
      <option value="">—</option>
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>{opt.label}</option>
      ))}
    </select>
  </div>
);

export default PromptWriter;
