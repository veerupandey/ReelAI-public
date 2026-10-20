import React, { useState, useRef, useEffect, useMemo } from 'react';
import type { CreativeRoute, AspectRatio, StudioAsset, BrandKnowledge, ProductTruth, TrendResearchResult, ComposerReference } from './types';
import PromptWriter, { type PromptWriterSeed } from './PromptWriter';
import type { PromptWriterSlide } from './promptWriterService';
import { mergeLockedReferences } from './creativeCopilotService';
import {
  ASPECT_RATIO_OPTIONS,
  formatAspectRatioLabel,
  makeCustomAspectId,
  parsePixelAspectId,
  resolveAspectRatioOption,
} from './aspectRatioCatalog';

export interface GenerationPanelProps {
  prompt: string;
  creativeRoute: CreativeRoute;
  aspectRatio: AspectRatio;
  selectedAssets: StudioAsset[];
  allAssets: StudioAsset[];
  composerReferences: ComposerReference[];
  isGenerating: boolean;
  isEnhancing: boolean;
  brandKnowledge?: BrandKnowledge;
  productTruth?: ProductTruth;
  trendResearch?: TrendResearchResult;
  brandUrlInput?: string;
  onBrandUrlChange?: (text: string) => void;
  promptWriterSeed?: PromptWriterSeed | null;
  promptWriterOpenToken?: number;
  onPromptChange: (text: string) => void;
  onApplyEnrichedPrompt: (text: string) => void;
  onApplyAndGenerate: (text: string) => void;
  onGenerateAllSlides?: (slides: PromptWriterSlide[]) => void | Promise<void>;
  onRouteChange: (route: CreativeRoute) => void;
  onAspectRatioChange: (ratio: AspectRatio) => void;
  onEnhance: () => void;
  onGenerate: () => void;
  onGenerateBatch?: (count: number) => void | Promise<void>;
  onOpenRoleAssignment: () => void;
  variationCount?: number;
  onVariationCountChange?: (count: number) => void;
  batchProgress?: {
    completed: number;
    total: number;
    failed: number;
    running: boolean;
  } | null;
  onStopBatch?: () => void;
}

const CREATIVE_ROUTES: {
  key: CreativeRoute;
  label: string;
  shortLabel: string;
  icon: React.ReactNode;
  description: string;
}[] = [
  {
    key: 'generate_fresh',
    label: 'Generate Fresh',
    shortLabel: 'Generate',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
      </svg>
    ),
    description: 'Create a brand new image from text',
  },
  {
    key: 'ai_upgrade',
    label: 'AI Upgrade',
    shortLabel: 'Upgrade',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M4.5 10.5L12 3m0 0l7.5 7.5M12 3v18" />
      </svg>
    ),
    description: 'Enhance an existing image with AI',
  },
  {
    key: 'composite',
    label: 'Composite',
    shortLabel: 'Composite',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 6A2.25 2.25 0 016 3.75h2.25A2.25 2.25 0 0110.5 6v2.25a2.25 2.25 0 01-2.25 2.25H6a2.25 2.25 0 01-2.25-2.25V6zM3.75 15.75A2.25 2.25 0 016 13.5h2.25a2.25 2.25 0 012.25 2.25V18a2.25 2.25 0 01-2.25 2.25H6A2.25 2.25 0 013.75 18v-2.25zM13.5 6a2.25 2.25 0 012.25-2.25H18A2.25 2.25 0 0120.25 6v2.25A2.25 2.25 0 0118 10.5h-2.25a2.25 2.25 0 01-2.25-2.25V6zM13.5 15.75a2.25 2.25 0 012.25-2.25H18a2.25 2.25 0 012.25 2.25V18A2.25 2.25 0 0118 20.25h-2.25A2.25 2.25 0 0113.5 18v-2.25z" />
      </svg>
    ),
    description: 'Blend multiple reference images',
  },
  {
    key: 'edit',
    label: 'Edit',
    shortLabel: 'Edit',
    icon: (
      <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
        <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125" />
      </svg>
    ),
    description: 'Modify parts of a specific image',
  },
];

const PRIMARY_ASPECT_IDS = ['9:16', '4:5', '1:1', '16:9'] as const;
const MAX_PROMPT_LENGTH = 10000;

/**
 * GenerationPanel — redesigned after studying Ideogram and Runway Gen-4 UX.
 *
 * Design principles applied:
 * - Prompt is the hero: large textarea sits at the top, always prominent
 * - References shown as inline thumbnail chips directly below the prompt
 *   (Ideogram pattern: reference thumbnails appear adjacent to prompt box)
 * - Route selector collapsed to a compact icon pill-strip — contextual, not dominant
 * - Aspect ratio as a minimal horizontal chip strip (Ideogram style)
 * - Generate is a full-width primary CTA — impossible to miss
 * - Enhance lives as a ghost button inside the prompt header to reduce visual noise
 *
 * Requirements: 6.1, 6.5, 6.8, 6.10, 7.1, 7.4, 7.6, 8.1, 8.2, 8.4, 8.5, 11.5
 */
const GenerationPanel: React.FC<GenerationPanelProps> = ({
  prompt,
  creativeRoute,
  aspectRatio,
  selectedAssets,
  allAssets,
  composerReferences,
  isGenerating,
  isEnhancing,
  brandKnowledge,
  productTruth,
  trendResearch,
  brandUrlInput = '',
  onBrandUrlChange,
  promptWriterSeed = null,
  promptWriterOpenToken = 0,
  onPromptChange,
  onApplyEnrichedPrompt,
  onApplyAndGenerate,
  onGenerateAllSlides,
  onRouteChange,
  onAspectRatioChange,
  onEnhance,
  onGenerate,
  onGenerateBatch,
  onOpenRoleAssignment,
  variationCount = 1,
  onVariationCountChange,
  batchProgress = null,
  onStopBatch,
}) => {
  const [showRouteMenu, setShowRouteMenu] = useState(false);
  const [showPromptWriter, setShowPromptWriter] = useState(false);
  const [showAspectMore, setShowAspectMore] = useState(false);
  const [customWidth, setCustomWidth] = useState('1464');
  const [customHeight, setCustomHeight] = useState('600');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const activeAspect = resolveAspectRatioOption(aspectRatio);
  const primaryAspects = ASPECT_RATIO_OPTIONS.filter((o) =>
    (PRIMARY_ASPECT_IDS as readonly string[]).includes(o.id),
  );
  const extraAspects = ASPECT_RATIO_OPTIONS.filter(
    (o) => !(PRIMARY_ASPECT_IDS as readonly string[]).includes(o.id),
  );
  const isCustomPixelAspect = !!parsePixelAspectId(aspectRatio)
    && !ASPECT_RATIO_OPTIONS.some((o) => o.id === aspectRatio);

  useEffect(() => {
    if (promptWriterOpenToken > 0) {
      setShowPromptWriter(true);
    }
  }, [promptWriterOpenToken]);

  useEffect(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [prompt]);

  const isAiOperationActive = isGenerating || isEnhancing;
  const isPromptEmpty = prompt.trim().length === 0;
  const isGenerateDisabled = isPromptEmpty || isAiOperationActive;
  const isEnhanceDisabled = isPromptEmpty || isAiOperationActive;

  const writerReferences = useMemo(
    () => mergeLockedReferences(composerReferences, new Set(selectedAssets.map((asset) => asset.id))),
    [composerReferences, selectedAssets],
  );

  const activeRoute = CREATIVE_ROUTES.find((r) => r.key === creativeRoute) ?? CREATIVE_ROUTES[0];
  const showCompositeRolePrompt = creativeRoute === 'composite' && selectedAssets.length >= 2;
  const needsBaseAsset = (creativeRoute === 'ai_upgrade' || creativeRoute === 'edit') && selectedAssets.length === 0;

  return (
    <div className="flex h-full min-h-[28rem] flex-col bg-studio-surface/95 border border-studio-border rounded-xl shadow-sm shadow-black/20 overflow-hidden">
      <div className="min-h-0 flex-1 overflow-y-auto flex flex-col gap-3">
      {/* ── Prompt area ─────────────────────────────────────────────── */}
      <div className="px-4 pt-4">
        {/* Prompt header row */}
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-semibold text-studio-mist/80 uppercase tracking-[0.14em]">Prompt</span>
          <div className="flex items-center gap-1.5">
            {/* Prompt Writer */}
            <button
              type="button"
              onClick={() => setShowPromptWriter(true)}
              disabled={isAiOperationActive}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-semibold text-teal-100 bg-studio-accent/15 hover:text-white hover:bg-studio-accent/25 transition-colors focus:outline-none focus:ring-1 focus:ring-studio-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="AI Prompt Writer"
            >
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Prompt Writer</span>
            </button>

            {/* Enhance */}
            <button
              type="button"
              onClick={onEnhance}
              disabled={isEnhanceDisabled}
              className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg text-[11px] font-medium text-gray-400 hover:text-teal-200 hover:bg-studio-accent/10 transition-colors focus:outline-none focus:ring-1 focus:ring-studio-accent/50 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="AI Enhance prompt"
            >
              {isEnhancing ? (
                <>
                  <Spinner className="w-3 h-3" />
                  <span>Enhancing…</span>
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
                  </svg>
                  <span>Enhance</span>
                </>
              )}
            </button>
          </div>
        </div>

        {onBrandUrlChange && (
          <div className="mb-3">
            <label
              htmlFor="gen-brand-url"
              className="block text-[10px] font-semibold uppercase tracking-[0.12em] text-studio-mist/70 mb-1"
            >
              Brand URL
              {brandKnowledge ? (
                <span className="ml-1 normal-case text-emerald-400/90">(researched)</span>
              ) : null}
            </label>
            <input
              id="gen-brand-url"
              type="url"
              value={brandUrlInput}
              onChange={(e) => onBrandUrlChange(e.target.value)}
              disabled={isAiOperationActive}
              placeholder="https://yourbrand.com"
              className="w-full rounded-lg border border-studio-border/80 bg-studio-canvas/40 px-3 py-2 text-xs text-studio-ink placeholder:text-studio-mist/40 focus:outline-none focus:ring-1 focus:ring-studio-accent/50 disabled:opacity-50"
            />
          </div>
        )}

        {/* Textarea - auto-expanding with max height */}
        <div className="max-h-[400px] overflow-y-auto">
          <textarea
            ref={textareaRef}
            id="generation-prompt"
            value={prompt}
            onChange={(e) => onPromptChange(e.target.value)}
            maxLength={MAX_PROMPT_LENGTH}
            // Note: 10k limit is generous; Gemini can handle very long prompts
            disabled={isAiOperationActive}
            placeholder="Describe the image you want to create…"
            rows={6}
            className="w-full min-h-[120px] px-0 py-0 bg-transparent border-none text-white text-sm placeholder-gray-600 resize-y focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed leading-relaxed"
            aria-describedby="prompt-char-count"
          />
        </div>

        {/* Locked reference chips (Ideogram-style: inline adjacent to prompt) */}
        {selectedAssets.length > 0 && (
          <div className="flex items-center gap-1.5 flex-wrap pt-2 pb-1 border-t border-white/5 mt-2">
            {selectedAssets.slice(0, 6).map((asset) => (
              <div
                key={asset.id}
                className="relative group flex-shrink-0"
                title={`${asset.name} (selected)`}
              >
                <div className="w-8 h-8 rounded-md overflow-hidden border border-studio-accent/50 ring-1 ring-studio-accent/30">
                  <img
                    src={`data:${asset.mimeType};base64,${asset.base64}`}
                    alt={asset.name}
                    className="w-full h-full object-cover"
                  />
                </div>
              </div>
            ))}
            {selectedAssets.length > 6 && (
              <span className="text-[10px] text-gray-500">+{selectedAssets.length - 6}</span>
            )}
            <span className="text-[10px] text-purple-300/80 ml-0.5">
              {selectedAssets.length} selected
              {creativeRoute === 'ai_upgrade' || creativeRoute === 'edit'
                ? ' · base'
                : creativeRoute === 'composite'
                ? ' · refs'
                : ''}
            </span>
          </div>
        )}

        {/* Char count */}
        <div className="flex justify-end pt-1" id="prompt-char-count" aria-live="polite">
          <span className={`text-[10px] ${prompt.length > MAX_PROMPT_LENGTH * 0.9 ? 'text-amber-400' : 'text-gray-600'}`}>
            {prompt.length}
          </span>
        </div>
      </div>

      {/* ── Divider ─────────────────────────────────────────────────── */}
      <div className="h-px bg-white/5 mx-4" />

      {/* ── Controls row ────────────────────────────────────────────── */}
      <div className="flex flex-col gap-2 px-4 pb-3">
        <div className="flex items-center gap-2">
          {/* Aspect ratio chip strip */}
          <div className="flex items-center gap-1 flex-1 flex-wrap" role="radiogroup" aria-label="Aspect ratio">
            {primaryAspects.map((r) => {
              const isActive = aspectRatio === r.id;
              const maxDim = 14;
              const scale = maxDim / Math.max(r.w, r.h);
              const pw = Math.max(4, Math.round(Math.min(r.w, 32) * Math.min(scale, 1)));
              const ph = Math.max(4, Math.round(Math.min(r.h, 32) * Math.min(scale, 1)));
              return (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={isActive}
                  aria-label={`Aspect ratio ${r.label}`}
                  disabled={isAiOperationActive}
                  onClick={() => onAspectRatioChange(r.id)}
                  className={`flex items-center gap-1 px-2 py-1.5 rounded-lg text-[11px] font-medium transition-all focus:outline-none focus:ring-1 focus:ring-studio-accent/50 ${
                    isActive
                      ? 'bg-studio-accent/20 text-teal-100 border border-studio-accent/40'
                      : 'text-gray-500 hover:text-gray-300 hover:bg-white/5 border border-transparent'
                  } ${isAiOperationActive ? 'opacity-50 cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  <div
                    className={`border rounded-[2px] flex-shrink-0 ${isActive ? 'border-studio-accent' : 'border-gray-600'}`}
                    style={{ width: `${pw}px`, height: `${ph}px` }}
                    aria-hidden="true"
                  />
                  <span>{r.shortLabel}</span>
                </button>
              );
            })}
            <button
              type="button"
              onClick={() => setShowAspectMore((v) => !v)}
              disabled={isAiOperationActive}
              className={`px-2 py-1.5 rounded-lg text-[11px] font-medium border transition-all ${
                showAspectMore || !PRIMARY_ASPECT_IDS.includes(aspectRatio as typeof PRIMARY_ASPECT_IDS[number])
                  ? 'bg-studio-accent/15 border-studio-accent/30 text-teal-100'
                  : 'text-gray-500 border-transparent hover:text-gray-300 hover:bg-white/5'
              }`}
              aria-expanded={showAspectMore}
              aria-label="More aspect ratios"
            >
              {PRIMARY_ASPECT_IDS.includes(aspectRatio as typeof PRIMARY_ASPECT_IDS[number])
                ? 'More'
                : formatAspectRatioLabel(aspectRatio)}
            </button>
          </div>

          {/* Route pill — compact dropdown trigger (Runway-style) */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setShowRouteMenu((v) => !v)}
              disabled={isAiOperationActive}
              className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-all focus:outline-none focus:ring-1 focus:ring-studio-accent/50 ${
                isAiOperationActive ? 'opacity-50 cursor-not-allowed' : ''
              } ${
                creativeRoute !== 'generate_fresh'
                  ? 'bg-studio-accent/15 border-studio-accent/30 text-teal-100'
                  : 'bg-white/5 border-studio-border text-gray-400 hover:text-white hover:bg-white/10'
              }`}
              aria-label={`Mode: ${activeRoute.label}`}
              aria-expanded={showRouteMenu}
            >
              {activeRoute.icon}
              <span>{activeRoute.shortLabel}</span>
              <svg className="w-3 h-3 text-current opacity-60" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M19.5 8.25l-7.5 7.5-7.5-7.5" />
              </svg>
            </button>

            {showRouteMenu && (
              <div className="absolute bottom-full right-0 mb-1.5 w-52 bg-studio-surface border border-studio-border rounded-xl shadow-2xl shadow-black/50 overflow-hidden z-20">
                {CREATIVE_ROUTES.map((route) => {
                  const isActive = creativeRoute === route.key;
                  return (
                    <button
                      key={route.key}
                      type="button"
                      onClick={() => { onRouteChange(route.key); setShowRouteMenu(false); }}
                      className={`w-full flex items-start gap-3 px-4 py-3 text-left transition-colors hover:bg-white/5 focus:outline-none ${isActive ? 'bg-studio-accent/10' : ''}`}
                      aria-label={route.label}
                    >
                      <span className={`mt-0.5 flex-shrink-0 ${isActive ? 'text-teal-200' : 'text-gray-500'}`}>
                        {route.icon}
                      </span>
                      <div>
                        <p className={`text-xs font-semibold ${isActive ? 'text-teal-100' : 'text-gray-200'}`}>{route.label}</p>
                        <p className="text-[10px] text-gray-500 leading-snug mt-0.5">{route.description}</p>
                      </div>
                      {isActive && (
                        <svg className="w-3.5 h-3.5 text-studio-accent ml-auto flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                          <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {showAspectMore && (
          <div className="rounded-xl border border-studio-border/80 bg-studio-canvas/30 p-2.5 space-y-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold px-0.5">Amazon A+ & more</p>
            <div className="flex flex-wrap gap-1.5">
              {extraAspects.map((r) => {
                const isActive = aspectRatio === r.id;
                return (
                  <button
                    key={r.id}
                    type="button"
                    disabled={isAiOperationActive}
                    onClick={() => {
                      onAspectRatioChange(r.id);
                      if (r.targetWidth && r.targetHeight) {
                        setCustomWidth(String(r.targetWidth));
                        setCustomHeight(String(r.targetHeight));
                      }
                    }}
                    title={r.description}
                    className={`px-2.5 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                      isActive
                        ? 'bg-studio-accent/20 text-teal-50 border-studio-accent/40'
                        : 'text-gray-400 border-studio-border hover:text-white hover:bg-white/5'
                    }`}
                  >
                    {r.shortLabel}
                    {r.targetWidth ? (
                      <span className="block text-[9px] text-gray-500 mt-0.5">
                        {r.targetWidth}×{r.targetHeight}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
            <div className="flex flex-wrap items-end gap-2 pt-1 border-t border-white/5">
              <label className="space-y-1">
                <span className="block text-[10px] text-gray-500">Width px</span>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  value={customWidth}
                  onChange={(e) => setCustomWidth(e.target.value)}
                  disabled={isAiOperationActive}
                  className="w-[5.5rem] rounded-lg border border-studio-border bg-studio-canvas/50 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent/50"
                />
              </label>
              <span className="text-gray-600 pb-2">×</span>
              <label className="space-y-1">
                <span className="block text-[10px] text-gray-500">Height px</span>
                <input
                  type="number"
                  min={64}
                  max={8192}
                  value={customHeight}
                  onChange={(e) => setCustomHeight(e.target.value)}
                  disabled={isAiOperationActive}
                  className="w-[5.5rem] rounded-lg border border-studio-border bg-studio-canvas/50 px-2 py-1.5 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent/50"
                />
              </label>
              <button
                type="button"
                disabled={isAiOperationActive}
                onClick={() => {
                  const w = Number(customWidth);
                  const h = Number(customHeight);
                  if (!Number.isFinite(w) || !Number.isFinite(h) || w < 64 || h < 64) return;
                  onAspectRatioChange(makeCustomAspectId(w, h));
                }}
                className="px-3 py-1.5 rounded-lg text-[11px] font-semibold bg-studio-accent/20 text-teal-50 border border-studio-accent/40 hover:bg-studio-accent/30"
              >
                Apply custom
              </button>
              {(isCustomPixelAspect || activeAspect.group === 'amazon') && (
                <p className="w-full text-[10px] text-gray-500">
                  Active: {formatAspectRatioLabel(aspectRatio)}
                  {activeAspect.description ? ` — ${activeAspect.description}` : ''}
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      {/* ── Inline status banners (only when truly needed) ──────────── */}
      {showCompositeRolePrompt && (
        <div className="mx-4 mb-1 flex items-center justify-between px-3 py-2 bg-purple-500/8 border border-purple-500/20 rounded-lg">
          <span className="text-xs text-purple-300">{selectedAssets.length} selected</span>
          <button
            type="button"
            onClick={onOpenRoleAssignment}
            disabled={isAiOperationActive}
            className="px-2.5 py-1 text-[11px] font-medium text-teal-200 bg-studio-accent/20 rounded-md hover:bg-studio-accent/30 transition-colors focus:outline-none disabled:opacity-50"
          >
            Assign Roles
          </button>
        </div>
      )}

      {needsBaseAsset && (
        <div className="mx-4 mb-1 px-3 py-2 bg-amber-500/8 border border-amber-500/20 rounded-lg">
          <p className="text-[11px] text-amber-400">
            Select an image from the gallery to use as the base.
          </p>
        </div>
      )}
      </div>

      {/* ── Generate CTA (pinned — never scrolls under assistant/product truth) ── */}
      <div className="flex-shrink-0 border-t border-studio-border/70 bg-studio-surface/98 px-3 py-3 space-y-2">
        {onVariationCountChange && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Variations</span>
            <div className="flex items-center gap-1" role="radiogroup" aria-label="Variation count">
              {[1, 2, 4].map((count) => (
                <button
                  key={count}
                  type="button"
                  role="radio"
                  aria-checked={variationCount === count}
                  disabled={isAiOperationActive}
                  onClick={() => onVariationCountChange(count)}
                  className={`min-w-[36px] px-2.5 py-1 rounded-lg text-[11px] font-medium transition-colors ${
                    variationCount === count
                      ? 'bg-studio-accent/25 text-teal-50 border border-studio-accent/40'
                      : 'text-gray-500 border border-transparent hover:text-gray-300 hover:bg-white/5'
                  } disabled:opacity-40`}
                >
                  {count}
                </button>
              ))}
            </div>
          </div>
        )}
        {batchProgress && batchProgress.total > 1 && (
          <div
            className="rounded-lg border border-studio-accent/20 bg-studio-accent/10 px-3 py-2"
            role="status"
            aria-live="polite"
          >
            <div className="mb-1.5 flex items-center justify-between text-[11px]">
              <span className="text-teal-50">
                {batchProgress.running
                  ? `Generating ${batchProgress.completed}/${batchProgress.total}`
                  : `${batchProgress.completed - batchProgress.failed}/${batchProgress.total} generated`}
              </span>
              <div className="flex items-center gap-2">
                {batchProgress.failed > 0 && (
                  <span className="text-amber-300">
                    {batchProgress.failed} failed
                  </span>
                )}
                {batchProgress.running && onStopBatch && (
                  <button
                    type="button"
                    onClick={onStopBatch}
                    className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-red-500/20 border border-red-500/40 text-red-300 text-[10px] font-semibold hover:bg-red-500/30 hover:text-red-200 transition-colors"
                    aria-label="Stop batch generation"
                  >
                    <svg className="w-2.5 h-2.5" fill="currentColor" viewBox="0 0 24 24">
                      <rect x="6" y="6" width="12" height="12" rx="1.5" />
                    </svg>
                    Stop
                  </button>
                )}
              </div>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-studio-canvas/30">
              <div
                className="h-full rounded-full bg-gradient-to-r from-studio-accent to-teal-300 transition-all"
                style={{
                  width: `${Math.round(
                    (batchProgress.completed / batchProgress.total) * 100,
                  )}%`,
                }}
              />
            </div>
          </div>
        )}
        <button
          type="button"
          onClick={() => {
            if (variationCount > 1 && onGenerateBatch) {
              onGenerateBatch(variationCount);
            } else {
              onGenerate();
            }
          }}
          disabled={isGenerateDisabled}
          className="w-full flex items-center justify-center gap-2 px-4 py-3 rounded-xl bg-gradient-to-r from-studio-accent to-studio-accent-strong text-white text-sm font-semibold hover:from-studio-accent hover:to-teal-400 hover:shadow-lg hover:shadow-studio-accent/20 active:scale-[0.99] transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
          aria-label={variationCount > 1 ? `Generate ${variationCount} variations` : 'Generate image'}
        >
          {isGenerating ? (
            <>
              <Spinner className="w-4 h-4" />
              <span>Generating{variationCount > 1 ? ` variations…` : '…'}</span>
            </>
          ) : (
            <>
              <svg className="w-4 h-4 opacity-80" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M9.813 15.904L9 18.75l-.813-2.846a4.5 4.5 0 00-3.09-3.09L2.25 12l2.846-.813a4.5 4.5 0 003.09-3.09L9 5.25l.813 2.846a4.5 4.5 0 003.09 3.09L15.75 12l-2.846.813a4.5 4.5 0 00-3.09 3.09z" />
              </svg>
              <span>{variationCount > 1 ? `Generate ${variationCount} Variations` : 'Generate Image'}</span>
            </>
          )}
        </button>
      </div>
      {/* Prompt Writer modal — always mounted, hidden via CSS to preserve state */}
      <div className={showPromptWriter ? '' : 'hidden'}>
        <PromptWriter
          composerReferences={writerReferences}
          assets={allAssets}
          aspectRatio={aspectRatio}
          brandKnowledge={brandKnowledge}
          productTruth={productTruth}
          trendResearch={trendResearch}
          brandUrlInput={brandUrlInput}
          onBrandUrlChange={onBrandUrlChange}
          onAspectRatioChange={onAspectRatioChange}
          seed={promptWriterSeed}
          seedToken={promptWriterOpenToken}
          isOpen={showPromptWriter}
          onApplyPrompt={(text, negativePrompt) => {
            const fullPrompt = negativePrompt
              ? `${text}\n\nNEGATIVE PROMPT (things to avoid): ${negativePrompt}`
              : text;
            onApplyEnrichedPrompt(fullPrompt);
            setShowPromptWriter(false);
          }}
          onApplyAndGenerate={(text, negativePrompt) => {
            const fullPrompt = negativePrompt
              ? `${text}\n\nNEGATIVE PROMPT (things to avoid): ${negativePrompt}`
              : text;
            onApplyAndGenerate(fullPrompt);
            setShowPromptWriter(false);
          }}
          onGenerateAllSlides={onGenerateAllSlides
            ? async (slides) => {
                setShowPromptWriter(false);
                await onGenerateAllSlides(slides);
              }
            : undefined}
          onClose={() => setShowPromptWriter(false)}
        />
      </div>
    </div>
  );
};

/**
 * Spinner — small animated loading indicator.
 */
const Spinner: React.FC<{ className?: string }> = ({ className = 'h-4 w-4' }) => (
  <svg
    className={`animate-spin ${className}`}
    xmlns="http://www.w3.org/2000/svg"
    fill="none"
    viewBox="0 0 24 24"
    aria-hidden="true"
  >
    <circle
      className="opacity-25"
      cx="12"
      cy="12"
      r="10"
      stroke="currentColor"
      strokeWidth="4"
    />
    <path
      className="opacity-75"
      fill="currentColor"
      d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
    />
  </svg>
);

export default GenerationPanel;
