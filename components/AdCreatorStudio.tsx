/**
 * Ad Creator studio UI — Prompt Writer–inspired guided compose surface.
 * Product + direction first; format/look as chips; research & refs progressive.
 */

import React, { useEffect, useRef, useState } from 'react';
import type { AgentDefinition } from '../runtime/agentDefinitions';
import type { AgentAvailability } from '../runtime/agentRegistry';
import {
  AD_AGENT_DEFAULT_I2V_MODEL_ID,
  AD_AGENT_DURATION_MAX,
  AD_AGENT_DURATION_MIN,
  AD_AGENT_DURATION_PRESETS,
  AD_AGENT_I2V_MODEL_OPTIONS,
  AD_AGENT_VOICE_OPTIONS,
  clampAdAgentDurationSec,
  coerceAdAgentI2vModelId,
  isAdAgentDurationPreset,
} from '../runtime/adAgentOptions';
import type { CreativeReferenceUpload } from '../services/creativeReferenceDirector';
import {
  coerceVideoVibe,
  defaultVibeForPlatform,
  VIDEO_VIBE_OPTIONS,
} from '../services/adAgentVideoTreatment';
import PlannerModelControls from './PlannerModelControls';
import { coercePlannerModelId } from '../services/llm/types';
import { captureReferencePostUrl } from '../services/referencePostCapture';
import {
  applyParsedDirection,
  describeParsedDirection,
  parseAdDirection,
  type ParsedAdDirection,
} from '../runtime/adDirectionParse';
import { urlHostLabel } from '../services/promptUrlRoles';
import AdAgentResearchPanel, { type AdAgentResearchSeed } from './AdAgentResearchPanel';
import { ingestCreativeReferenceFiles, readCreativeReferenceFile } from './AgentConsole';

const FORMAT_OPTIONS = [
  { value: 'stitched_video', label: 'Video Ad', hint: 'Stills + motion + VO' },
  { value: 'static_image', label: 'Static', hint: 'Single 4:5' },
  { value: 'carousel', label: 'Carousel', hint: 'Multi-slide 1:1' },
  { value: 'veo3_video', label: 'Veo3', hint: 'AI video · costly' },
] as const;

const PLATFORM_OPTIONS = [
  { value: 'instagram_reels', label: 'Reels', hint: '9:16' },
  { value: 'tiktok', label: 'TikTok', hint: '9:16' },
  { value: 'youtube_shorts', label: 'Shorts', hint: '9:16' },
  { value: 'instagram_feed', label: 'Feed', hint: '4:5' },
  { value: 'instagram_carousel', label: 'Carousel', hint: '1:1' },
] as const;

const STYLE_OPTIONS = [
  { value: 'luxe_minimalist', label: 'Luxe Minimalist' },
  { value: 'earthy_organic', label: 'Earthy & Organic' },
  { value: 'high_energy', label: 'High Energy' },
  { value: 'ugc_style', label: 'UGC Style' },
] as const;

const VOICE_OPTIONS = AD_AGENT_VOICE_OPTIONS;

/** Below this, the parse is mostly defaults — open Adjust so they are visible. */
const LOW_PARSE_CONFIDENCE = 0.5;

const EXAMPLE_DIRECTIONS = [
  '30s Reels — morning ritual vs coffee, calm luxury, product-hero close-ups',
  'TikTok UGC energy — creator unboxing, honest first impression, soft CTA',
  'Carousel — 5 slides teaching one benefit, clean typography, packshot hero',
];

type ChipProps = {
  active: boolean;
  label: string;
  hint?: string;
  onClick: () => void;
  disabled?: boolean;
};

const Chip: React.FC<ChipProps> = ({ active, label, hint, onClick, disabled }) => (
  <button
    type="button"
    disabled={disabled}
    onClick={onClick}
    className={`px-3 py-2 rounded-xl border text-left transition-all disabled:opacity-40 ${
      active
        ? 'border-teal-400/70 bg-teal-500/15 text-teal-100'
        : 'border-white/10 bg-white/[0.03] text-gray-400 hover:border-white/20 hover:text-gray-200'
    }`}
  >
    <span className="text-xs font-semibold block">{label}</span>
    {hint && <span className="text-[10px] text-gray-500 block mt-0.5">{hint}</span>}
  </button>
);

const SectionLabel: React.FC<{ step?: string; children: React.ReactNode; hint?: string }> = ({
  step,
  children,
  hint,
}) => (
  <div className="mb-3">
    <div className="flex items-baseline gap-2">
      {step && (
        <span className="text-[10px] font-bold uppercase tracking-widest text-teal-400/90">{step}</span>
      )}
      <h3 className="text-sm font-semibold text-white">{children}</h3>
    </div>
    {hint && <p className="mt-1 text-[11px] text-gray-500 leading-relaxed">{hint}</p>}
  </div>
);

export interface AdCreatorStudioProps {
  agent: AgentDefinition;
  availability: AgentAvailability | null;
  formValues: Record<string, string | number | boolean>;
  onChangeForm: (id: string, value: string | number | boolean) => void;
  direction: string;
  onDirectionChange: (value: string) => void;
  productPackshot: CreativeReferenceUpload | null;
  onPackshotChange: (value: CreativeReferenceUpload | null) => void;
  referenceUploads: CreativeReferenceUpload[];
  onReferenceUploadsChange: (value: CreativeReferenceUpload[]) => void;
  researchSeed: AdAgentResearchSeed | null;
  onResearchApply: (seed: AdAgentResearchSeed) => void;
  onResearchBriefChange: (brief: string) => void;
  formError: string | null;
  formErrorField: string | null;
  isUploading: boolean;
  onUploadingChange: (value: boolean) => void;
  onLaunch: () => void;
  onCancel: () => void;
  formRef: React.RefObject<HTMLDivElement | null>;
}

const AdCreatorStudio: React.FC<AdCreatorStudioProps> = ({
  agent,
  availability,
  formValues,
  onChangeForm: onChangeFormProp,
  direction,
  onDirectionChange,
  productPackshot,
  onPackshotChange,
  referenceUploads,
  onReferenceUploadsChange,
  researchSeed,
  onResearchApply,
  onResearchBriefChange,
  formError,
  formErrorField,
  isUploading,
  onUploadingChange,
  onLaunch,
  onCancel,
  formRef,
}) => {
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [showAdjust, setShowAdjust] = useState(false);
  const [parsed, setParsed] = useState<ParsedAdDirection | null>(null);
  /** Once the user opens or closes settings themselves, parsing stops deciding. */
  const adjustTouchedRef = useRef(false);
  /** Fields the user set by hand — direction re-parses must never overwrite these. */
  const touchedKeysRef = useRef<Set<string>>(new Set());
  const formValuesRef = useRef(formValues);
  formValuesRef.current = formValues;

  /** Every control in this studio edits through here, so touch tracking is automatic. */
  const onChangeForm = (id: string, value: string | number | boolean) => {
    touchedKeysRef.current.add(id);
    onChangeFormProp(id, value);
  };

  const [showResearch, setShowResearch] = useState(Boolean(researchSeed));
  const [showRefs, setShowRefs] = useState(false);
  const [showLockedBrief, setShowLockedBrief] = useState(false);
  const [justApplied, setJustApplied] = useState(false);
  const [customDurationDraft, setCustomDurationDraft] = useState('20');
  const [capturingRef, setCapturingRef] = useState(false);
  const [captureError, setCaptureError] = useState<string | null>(null);
  const lockedBriefRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (researchSeed) {
      setShowResearch(true);
      setShowLockedBrief(false);
    }
  }, [researchSeed]);

  // Prompt-first: read the Direction and fill settings the user has not touched.
  useEffect(() => {
    const timer = window.setTimeout(() => {
      const touched = touchedKeysRef.current;
      const current = formValuesRef.current;
      const next = parseAdDirection({
        text: direction,
        explicitProductUrl: touched.has('productUrl') ? String(current.productUrl || '') : undefined,
        explicitReferenceUrl: touched.has('referenceUrl') ? String(current.referenceUrl || '') : undefined,
      });
      setParsed(next);
      // A vague direction means the defaults are guesses — show them once,
      // unless the user has already decided how they want this panel.
      if (!adjustTouchedRef.current && direction.trim() && next.confidence < LOW_PARSE_CONFIDENCE) {
        setShowAdjust(true);
      }
      const updates = applyParsedDirection({ parsed: next, current, touched });
      for (const [key, value] of Object.entries(updates)) {
        onChangeFormProp(key, value);
      }
    }, 600);
    return () => window.clearTimeout(timer);
  }, [direction, onChangeFormProp]);

  const handleResearchApplied = (_seed: AdAgentResearchSeed) => {
    setJustApplied(true);
    setShowLockedBrief(true);
    window.setTimeout(() => {
      lockedBriefRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }, 80);
    window.setTimeout(() => setJustApplied(false), 6000);
  };

  const adFormat = String(formValues.adFormat || 'stitched_video');
  const platform = String(formValues.platform || 'instagram_reels');
  const style = String(formValues.style || 'luxe_minimalist');
  const voice = String(formValues.voice || 'Kore');
  const durationSec = clampAdAgentDurationSec(formValues.durationSec || 30);
  const usingCustomDuration = !isAdAgentDurationPreset(durationSec);
  const reviewMode = Boolean(formValues.reviewMode);
  const productUrl = String(formValues.productUrl || '');
  // Reference URL lives in form values so it reaches the launch envelope as its own role.
  const referenceUrl = String(formValues.referenceUrl || '');
  const isVideo = adFormat === 'stitched_video' || adFormat === 'veo3_video';
  const vibe = coerceVideoVibe(formValues.vibe, defaultVibeForPlatform(platform));
  const shellOk = !availability || availability.available;

  const liveMotionLabel = AD_AGENT_I2V_MODEL_OPTIONS
    .find((m) => m.value === coerceAdAgentI2vModelId(formValues.liveMotionModelId))?.label || 'I2V';

  /** What the studio understood from Direction — each chip opens its control. */
  const understood: Array<{ key: string; label: string; value: string; onClick: () => void }> = [
    ...(parsed?.isRecreate
      ? [{ key: 'recreate', label: 'Intent', value: 'Recreate reference', onClick: () => setShowRefs(true) }]
      : []),
    {
      key: 'adFormat',
      label: 'Format',
      value: FORMAT_OPTIONS.find((f) => f.value === adFormat)?.label || 'Video Ad',
      onClick: () => setShowAdjust(true),
    },
    {
      key: 'platform',
      label: 'Platform',
      value: PLATFORM_OPTIONS.find((p) => p.value === platform)?.label || 'Reels',
      onClick: () => setShowAdjust(true),
    },
    ...(isVideo
      ? [{ key: 'durationSec', label: 'Duration', value: `${durationSec}s`, onClick: () => setShowAdjust(true) }]
      : []),
    {
      key: 'style',
      label: 'Style',
      value: STYLE_OPTIONS.find((s) => s.value === style)?.label || 'Luxe Minimalist',
      onClick: () => setShowAdjust(true),
    },
    ...(isVideo
      ? [{
          key: 'vibe',
          label: 'Vibe',
          value: VIDEO_VIBE_OPTIONS.find((v) => v.value === vibe)?.label || 'Balanced',
          onClick: () => setShowAdjust(true),
        }]
      : []),
    ...(adFormat === 'stitched_video' && formValues.preferLiveMotion
      ? [{ key: 'preferLiveMotion', label: 'Live Motion', value: liveMotionLabel, onClick: () => setShowAdjust(true) }]
      : []),
    ...(formValues.includeVoiceover === false
      ? [{ key: 'includeVoiceover', label: 'Voiceover', value: 'Off', onClick: () => setShowAdjust(true) }]
      : []),
    {
      key: 'productUrl',
      label: 'Product',
      value: productPackshot ? 'Packshot' : productUrl ? urlHostLabel(productUrl) : 'Not set',
      onClick: () => {
        const input = formRef.current?.querySelector('input[type="url"]') as HTMLInputElement | null;
        input?.focus();
      },
    },
    ...(referenceUrl || referenceUploads.length
      ? [{
          key: 'referenceUrl',
          label: 'Reference',
          value: referenceUrl ? urlHostLabel(referenceUrl) : `${referenceUploads.length} file(s)`,
          onClick: () => setShowRefs(true),
        }]
      : []),
    ...(researchSeed ? [{ key: 'brief', label: 'Brief', value: 'Ready', onClick: () => setShowLockedBrief(true) }] : []),
  ];

  return (
    <div ref={formRef} className="space-y-5">
      {/* Title row */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="text-2xl" aria-hidden>{agent.icon}</span>
            <h2 className="text-lg font-bold text-white tracking-tight">{agent.name}</h2>
          </div>
          <p className="text-[12px] text-gray-400">
            Describe the ad in your words — settings fill themselves, and every one stays editable.
          </p>
        </div>
      </div>

      {!shellOk && (
        <div className="px-4 py-3 rounded-xl bg-amber-500/10 border border-amber-500/30 text-xs text-amber-200">
          Shell server needed for video assembly. Run <code className="font-mono bg-black/30 px-1 rounded">npm run agent:server</code> then refresh.
        </div>
      )}

      {(researchSeed || justApplied) && (
        <div
          className={`px-4 py-3 rounded-xl border text-xs ${
            justApplied
              ? 'border-emerald-400/50 bg-emerald-500/20 text-emerald-100'
              : 'border-emerald-500/30 bg-emerald-500/10 text-emerald-200'
          }`}
          role="status"
        >
          <span className="font-semibold">Research locked for Launch</span>
          {researchSeed?.selectedConceptTitle ? ` · ${researchSeed.selectedConceptTitle}` : ''}
          {researchSeed?.productFacts?.length ? ` · ${researchSeed.productFacts.length} facts` : ''}
          . Your direction words stay as you wrote them — review the Locked brief card below.
        </div>
      )}

      {/* 1 — Direction (Prompt Writer hero) — human words only */}
      <section className="rounded-2xl border border-white/10 bg-gradient-to-b from-white/[0.04] to-transparent p-5 sm:p-6">
        <SectionLabel step="01" hint="Your words. Research never overwrites this — applied research lands in Locked brief below.">
          What should this ad feel like?
        </SectionLabel>
        <textarea
          value={direction}
          onChange={(e) => onDirectionChange(e.target.value)}
          rows={4}
          placeholder="e.g. 30s Instagram Reel — ceremonial matcha morning vs rushed coffee. Soft daylight, whisk close-up, quiet luxury, end on the tin."
          className="w-full px-4 py-3.5 rounded-xl bg-black/30 border border-white/10 text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40 focus:border-teal-500/50 resize-none leading-relaxed"
        />
        <div className="mt-3 flex flex-wrap gap-2">
          {EXAMPLE_DIRECTIONS.map((example) => (
            <button
              key={example}
              type="button"
              onClick={() => onDirectionChange(example)}
              className="text-[11px] px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-gray-400 hover:text-teal-100 hover:border-teal-500/40 transition-colors"
            >
              {example.length > 56 ? `${example.slice(0, 54)}…` : example}
            </button>
          ))}
        </div>

        {/* Understood — parsed settings, each chip opens its control */}
        <div className="mt-5 pt-4 border-t border-white/[0.06]">
          <div className="flex items-baseline justify-between gap-3 mb-2">
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">
              Understood
            </p>
            <button
              type="button"
              onClick={() => {
                adjustTouchedRef.current = true;
                setShowAdjust((v) => !v);
              }}
              className="text-[11px] text-teal-300/80 hover:text-teal-200 transition-colors"
            >
              {showAdjust ? 'Hide settings' : 'Adjust settings'}
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {understood.map((item) => (
              <button
                key={item.key}
                type="button"
                onClick={item.onClick}
                className={`text-[11px] px-2.5 py-1 rounded-full border transition-colors ${
                  touchedKeysRef.current.has(item.key)
                    ? 'border-white/20 bg-white/[0.06] text-gray-200'
                    : 'border-teal-500/25 bg-teal-500/[0.07] text-teal-100/90 hover:border-teal-400/50'
                }`}
                title={touchedKeysRef.current.has(item.key) ? 'You set this' : 'Read from your direction — click to change'}
              >
                <span className="text-gray-500">{item.label} </span>
                {item.value}
              </button>
            ))}
          </div>
          {parsed && describeParsedDirection(parsed) ? (
            <p className="mt-2 text-[10px] text-gray-600">
              From your direction: {describeParsedDirection(parsed)}
            </p>
          ) : null}
        </div>
      </section>

      {/* Locked brief — researcher output, separate from Direction */}
      {researchSeed?.creativeBrief && (
        <section
          ref={lockedBriefRef}
          className={`rounded-2xl border overflow-hidden transition-colors ${
            justApplied ? 'border-emerald-400/50 ring-2 ring-emerald-500/25' : 'border-teal-500/30'
          }`}
        >
          <button
            type="button"
            onClick={() => setShowLockedBrief((v) => !v)}
            className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left bg-teal-500/[0.06] hover:bg-teal-500/10 transition-colors"
          >
            <div>
              <p className="text-sm font-semibold text-teal-100">Locked brief</p>
              <p className="text-[11px] text-gray-500 mt-0.5">
                {researchSeed.selectedConceptTitle
                  ? `Concept: ${researchSeed.selectedConceptTitle}`
                  : 'Researcher strategist brief'}
                {researchSeed.productFacts?.length ? ` · ${researchSeed.productFacts.length} facts` : ''}
              </p>
            </div>
            <span className="text-teal-300/80 text-xs shrink-0">{showLockedBrief ? 'Hide' : 'Edit'}</span>
          </button>
          {showLockedBrief && (
            <div className="px-5 pb-5 pt-2 space-y-2 bg-teal-500/[0.03]">
              <textarea
                value={researchSeed.creativeBrief}
                onChange={(e) => onResearchBriefChange(e.target.value)}
                rows={8}
                className="w-full px-3 py-2.5 rounded-xl bg-black/25 border border-white/10 text-[11px] text-gray-200 font-mono leading-relaxed focus:outline-none focus:ring-2 focus:ring-teal-500/40 resize-y"
              />
              <p className="text-[10px] text-gray-600">
                This is what Launch sends as the creative brief. Direction above stays your human prompt.
              </p>
            </div>
          )}
        </section>
      )}

      {/* 2 — Product */}
      <section className="rounded-2xl border border-white/10 bg-dark-card/80 p-5 sm:p-6">
        <SectionLabel step="02" hint="URL imports facts & images. Packshot always wins as the product hero when both are set.">
          Product
        </SectionLabel>
        <div className="grid grid-cols-1 md:grid-cols-[1fr_auto] gap-4">
          <div>
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
              Product URL
            </label>
            <input
              type="url"
              value={productUrl}
              onChange={(e) => onChangeForm('productUrl', e.target.value)}
              placeholder="https://brand.com/products/your-product"
              className={`w-full px-3 py-2.5 rounded-xl bg-black/25 border text-sm text-white placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-teal-500/40 ${
                formErrorField === 'productUrl' ? 'border-red-500 ring-2 ring-red-500/30' : 'border-white/10'
              }`}
            />
          </div>
          <div className="md:w-56">
            <label className="block text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-1.5">
              Packshot
            </label>
            {productPackshot ? (
              <div className="relative rounded-xl border border-teal-500/40 bg-teal-500/10 overflow-hidden">
                <img
                  src={productPackshot.previewUrl}
                  alt={productPackshot.name}
                  className="h-28 w-full object-cover"
                />
                <div className="absolute inset-x-0 bottom-0 bg-black/60 px-2 py-1.5 flex items-center justify-between gap-2">
                  <p className="text-[10px] text-white truncate">{productPackshot.name}</p>
                  <button
                    type="button"
                    onClick={() => onPackshotChange(null)}
                    className="text-[10px] text-red-300 hover:text-red-200 shrink-0"
                  >
                    Remove
                  </button>
                </div>
              </div>
            ) : (
              <label className="flex flex-col items-center justify-center h-28 rounded-xl border border-dashed border-white/15 bg-white/[0.02] cursor-pointer hover:border-teal-500/40 hover:bg-teal-500/5 transition-colors px-3 text-center">
                <span className="text-xs font-semibold text-teal-200">
                  {isUploading ? 'Reading…' : 'Upload image'}
                </span>
                <span className="mt-1 text-[10px] text-gray-500">PNG / JPG / WebP</span>
                <input
                  hidden
                  accept="image/png,image/jpeg,image/webp"
                  type="file"
                  onChange={async (event) => {
                    const file = event.target.files?.[0];
                    event.target.value = '';
                    if (!file) return;
                    onUploadingChange(true);
                    try {
                      onPackshotChange(await readCreativeReferenceFile(file));
                    } finally {
                      onUploadingChange(false);
                    }
                  }}
                />
              </label>
            )}
          </div>
        </div>
      </section>

      {/* 3 & 4 — Adjust settings (collapsed until you want them) */}
      {showAdjust && (
        <>
      <section className="rounded-2xl border border-white/10 bg-dark-card/80 p-5 sm:p-6 space-y-5">
        <div>
          <SectionLabel step="03">Format & platform</SectionLabel>
          <div className="flex flex-wrap gap-2">
            {FORMAT_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                active={adFormat === opt.value}
                label={opt.label}
                hint={opt.hint}
                onClick={() => onChangeForm('adFormat', opt.value)}
              />
            ))}
          </div>
        </div>
        <div>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Platform</p>
          <div className="flex flex-wrap gap-2">
            {PLATFORM_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                active={platform === opt.value}
                label={opt.label}
                hint={opt.hint}
                onClick={() => onChangeForm('platform', opt.value)}
              />
            ))}
          </div>
        </div>
        {adFormat === 'stitched_video' && (
          <div className="rounded-xl border border-teal-500/20 bg-teal-500/[0.04] px-4 py-3 space-y-3">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-xs font-semibold text-teal-100">Live Motion</p>
                <p className="text-[10px] text-gray-500 mt-0.5 leading-relaxed">
                  Animate scene stills with Seedance, Kling, Veo, Grok, or Wan instead of Ken Burns. Flip scenes at the plan gate.
                </p>
              </div>
              <button
                type="button"
                onClick={() => onChangeForm('preferLiveMotion', !Boolean(formValues.preferLiveMotion))}
                className={`relative w-11 h-6 rounded-full transition-colors shrink-0 ${
                  formValues.preferLiveMotion ? 'bg-teal-500' : 'bg-gray-700'
                }`}
                aria-pressed={Boolean(formValues.preferLiveMotion)}
                aria-label="Enable Live Motion"
              >
                <span
                  className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${
                    formValues.preferLiveMotion ? 'translate-x-6' : 'translate-x-1'
                  }`}
                />
              </button>
            </div>
            {Boolean(formValues.preferLiveMotion) && (
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">I2V model</span>
                <select
                  value={coerceAdAgentI2vModelId(formValues.liveMotionModelId, AD_AGENT_DEFAULT_I2V_MODEL_ID)}
                  onChange={(e) => onChangeForm('liveMotionModelId', coerceAdAgentI2vModelId(e.target.value))}
                  className="w-full rounded-lg border border-teal-500/20 bg-dark-bg/80 px-3 py-2 text-xs text-gray-200 focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                  aria-label="Live Motion I2V model"
                >
                  {AD_AGENT_I2V_MODEL_OPTIONS.map((opt) => (
                    <option key={opt.value} value={opt.value}>
                      {opt.label} — {opt.description}
                    </option>
                  ))}
                </select>
              </label>
            )}
          </div>
        )}

        {isVideo && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Duration</p>
            <div className="flex flex-wrap gap-2">
              {AD_AGENT_DURATION_PRESETS.map((preset) => (
                <Chip
                  key={preset.sec}
                  active={durationSec === preset.sec}
                  label={`${preset.sec}s`}
                  hint={preset.label}
                  onClick={() => onChangeForm('durationSec', preset.sec)}
                />
              ))}
              <Chip
                active={usingCustomDuration}
                label={usingCustomDuration ? `${durationSec}s` : 'Custom'}
                hint={usingCustomDuration ? 'Custom' : `${AD_AGENT_DURATION_MIN}–${AD_AGENT_DURATION_MAX}`}
                onClick={() => {
                  const next = clampAdAgentDurationSec(customDurationDraft);
                  setCustomDurationDraft(String(next));
                  onChangeForm('durationSec', next);
                }}
              />
            </div>
            {usingCustomDuration && (
              <div className="mt-3 flex items-center gap-2">
                <input
                  type="number"
                  min={AD_AGENT_DURATION_MIN}
                  max={AD_AGENT_DURATION_MAX}
                  value={customDurationDraft}
                  onChange={(e) => {
                    setCustomDurationDraft(e.target.value);
                    const n = Number(e.target.value);
                    if (Number.isFinite(n)) onChangeForm('durationSec', clampAdAgentDurationSec(n));
                  }}
                  className="w-24 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm text-white focus:border-teal-500/50 focus:outline-none"
                />
                <span className="text-[11px] text-gray-500">
                  seconds ({AD_AGENT_DURATION_MIN}–{AD_AGENT_DURATION_MAX})
                </span>
              </div>
            )}
          </div>
        )}
      </section>

      {/* 4 — Look */}
      <section className="rounded-2xl border border-white/10 bg-dark-card/80 p-5 sm:p-6 space-y-5">
        <div>
          <SectionLabel step="04">Look & voice</SectionLabel>
          <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Visual style</p>
          <div className="flex flex-wrap gap-2">
            {STYLE_OPTIONS.map((opt) => (
              <Chip
                key={opt.value}
                active={style === opt.value}
                label={opt.label}
                onClick={() => onChangeForm('style', opt.value)}
              />
            ))}
          </div>
        </div>
        {isVideo && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Vibe</p>
            <div className="flex flex-wrap gap-2">
              {VIDEO_VIBE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  active={vibe === opt.value}
                  label={opt.label}
                  hint={opt.hint}
                  onClick={() => onChangeForm('vibe', opt.value)}
                />
              ))}
            </div>
            <p className="mt-1.5 text-[10px] text-gray-600">
              Drives hook energy, cut rhythm & voiceover voice — research and planning both follow it.
            </p>
          </div>
        )}
        {isVideo && (
          <div>
            <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Voiceover</p>
            <div className="flex flex-wrap gap-2">
              {VOICE_OPTIONS.map((opt) => (
                <Chip
                  key={opt.value}
                  active={voice === opt.value}
                  label={opt.label}
                  hint={opt.desc}
                  onClick={() => onChangeForm('voice', opt.value)}
                />
              ))}
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={() => setShowAdvanced((v) => !v)}
          className="text-[11px] text-gray-500 hover:text-gray-300 transition-colors"
        >
          {showAdvanced ? 'Hide advanced' : 'Advanced · review mode & planner'}
        </button>
        {showAdvanced && (
          <div className="rounded-xl border border-white/10 bg-black/20 p-4 space-y-4">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold text-gray-200">Auto-approve scenes</p>
                <p className="text-[10px] text-gray-500 mt-0.5">Off = pause for your OK. Always off for Veo3.</p>
              </div>
              <button
                type="button"
                onClick={() => onChangeForm('reviewMode', !reviewMode)}
                className={`relative w-11 h-6 rounded-full transition-colors ${reviewMode ? 'bg-teal-500' : 'bg-gray-700'}`}
              >
                <span className={`absolute top-1 w-4 h-4 rounded-full bg-white shadow transition-transform ${reviewMode ? 'translate-x-6' : 'translate-x-1'}`} />
              </button>
            </div>
            <div>
              <p className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold mb-2">Planner / Agent model</p>
              <PlannerModelControls
                value={coercePlannerModelId(formValues.plannerModel)}
                onChange={(id) => onChangeForm('plannerModel', id)}
                variant="chips"
              />
            </div>
          </div>
        )}
      </section>
        </>
      )}

      {/* 5 — Research (collapsible) */}
      <section className="rounded-2xl border border-teal-500/20 bg-teal-500/[0.04] overflow-hidden">
        <button
          type="button"
          onClick={() => setShowResearch((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-teal-500/5 transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-teal-100">Researcher</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Optional — uses your direction prompt above (same stack as Image Studio).
            </p>
          </div>
          <span className="text-teal-300/80 text-xs shrink-0">{showResearch ? 'Hide' : 'Open'}</span>
        </button>
        {showResearch && (
          <div className="px-5 pb-5">
            <AdAgentResearchPanel
              productUrl={productUrl}
              platform={platform}
              packshot={productPackshot ? {
                base64: productPackshot.base64,
                mimeType: productPackshot.mimeType,
                name: productPackshot.name,
              } : null}
              defaultGoal={direction.trim()}
              onApply={onResearchApply}
              onApplied={handleResearchApplied}
              embedded
              adFormat={adFormat}
              durationSec={durationSec}
              vibe={vibe}
            />
          </div>
        )}
      </section>

      {/* 6 — References (collapsible) */}
      <section className="rounded-2xl border border-white/10 bg-dark-card/60 overflow-hidden">
        <button
          type="button"
          onClick={() => setShowRefs((v) => !v)}
          className="w-full flex items-center justify-between gap-3 px-5 py-4 text-left hover:bg-white/[0.02] transition-colors"
        >
          <div>
            <p className="text-sm font-semibold text-gray-200">Creative references</p>
            <p className="text-[11px] text-gray-500 mt-0.5">
              Instagram link, video, or images — agent recreates structure for your brand
              {referenceUploads.length ? ` · ${referenceUploads.length} added` : ''}
            </p>
          </div>
          <span className="text-gray-400 text-xs shrink-0">{showRefs ? 'Hide' : 'Add'}</span>
        </button>
        {showRefs && (
          <div className="px-5 pb-5 space-y-3">
            <div className="space-y-2">
              <p className="text-[11px] text-gray-400">Reference Instagram / post URL</p>
              <div className="flex flex-col sm:flex-row gap-2">
                <input
                  type="url"
                  value={referenceUrl}
                  onChange={(e) => {
                    onChangeForm('referenceUrl', e.target.value);
                    setCaptureError(null);
                  }}
                  placeholder="https://www.instagram.com/reel/… or /p/…"
                  className="flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                />
                <button
                  type="button"
                  disabled={capturingRef || isUploading || !referenceUrl.trim()}
                  onClick={async () => {
                    setCapturingRef(true);
                    setCaptureError(null);
                    onUploadingChange(true);
                    try {
                      const result = await captureReferencePostUrl(referenceUrl, {
                        existingCount: referenceUploads.length,
                      });
                      onReferenceUploadsChange(
                        [...referenceUploads, ...result.uploads].slice(0, 12),
                      );
                      if (result.warning) setCaptureError(result.warning);
                      setShowRefs(true);
                    } catch (err: any) {
                      setCaptureError(
                        err?.message
                        || 'Capture failed. Upload the Reel/video file instead.',
                      );
                    } finally {
                      setCapturingRef(false);
                      onUploadingChange(false);
                    }
                  }}
                  className="shrink-0 rounded-xl border border-cyan-500/40 bg-cyan-500/15 px-3 py-2 text-xs font-semibold text-cyan-200 hover:bg-cyan-500/25 disabled:opacity-40"
                >
                  {capturingRef ? 'Capturing…' : 'Capture reference'}
                </button>
              </div>
              {captureError && (
                <p className="text-[11px] text-amber-300/90 leading-relaxed">{captureError}</p>
              )}
            </div>
            <label className="inline-flex cursor-pointer rounded-xl border border-cyan-500/30 bg-cyan-500/10 px-3 py-2 text-xs font-semibold text-cyan-300 hover:bg-cyan-500/20">
              {isUploading && !capturingRef ? 'Sampling…' : 'Add images / video'}
              <input
                hidden
                multiple
                accept="image/png,image/jpeg,image/webp,video/mp4,video/webm,video/quicktime,.mp4,.webm,.mov"
                type="file"
                onChange={async (event) => {
                  const files = event.target.files ? (Array.from(event.target.files) as File[]) : [];
                  event.target.value = '';
                  if (!files.length) return;
                  onUploadingChange(true);
                  setCaptureError(null);
                  try {
                    const room = Math.max(0, 12 - referenceUploads.length);
                    const { uploads, errors } = await ingestCreativeReferenceFiles(files, { maxTotal: room });
                    if (uploads.length) {
                      onReferenceUploadsChange([...referenceUploads, ...uploads].slice(0, 12));
                    }
                    if (errors.length) {
                      window.alert(errors.join('\n'));
                    }
                  } finally {
                    onUploadingChange(false);
                  }
                }}
              />
            </label>
            {referenceUploads.length > 0 && (
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                {referenceUploads.map((reference) => (
                  <div key={reference.id} className="rounded-xl border border-white/10 bg-black/20 p-2">
                    <img src={reference.previewUrl} alt={reference.name} className="h-20 w-full rounded-lg object-cover" />
                    <p className="mt-1 truncate text-[10px] text-gray-400">{reference.name}</p>
                    <input
                      value={reference.note}
                      onChange={(event) => onReferenceUploadsChange(
                        referenceUploads.map((item) =>
                          item.id === reference.id ? { ...item, note: event.target.value } : item,
                        ),
                      )}
                      placeholder="How to use this?"
                      className="mt-2 w-full rounded-lg border border-white/10 bg-dark-card px-2 py-1.5 text-[10px] text-white placeholder-gray-600 focus:border-cyan-500 focus:outline-none"
                    />
                    <button
                      type="button"
                      onClick={() => onReferenceUploadsChange(referenceUploads.filter((item) => item.id !== reference.id))}
                      className="mt-1 text-[10px] text-red-400 hover:text-red-300"
                    >
                      Remove
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </section>

      {formError && (
        <div className="px-4 py-3 rounded-xl bg-red-500/15 border border-red-500/40 text-sm text-red-300">
          {formError}
        </div>
      )}

      {/* Sticky launch */}
      <div className="sticky bottom-0 z-10 -mx-1 pt-2 pb-1">
        <div className="rounded-2xl border border-white/10 bg-dark-bg/95 backdrop-blur-xl p-3 sm:p-4 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 shadow-lg shadow-black/40">
          <div className="flex-1 min-w-0">
            <div className="min-w-0">
              <p className="text-xs text-gray-300 truncate">
                {researchSeed
                  ? `Ready · ${researchSeed.selectedConceptTitle || 'research brief locked'}`
                  : direction.trim() || 'Add a creative direction above to guide the agent'}
              </p>
              <p className="text-[10px] text-gray-600 mt-0.5">
                {understood.map((item) => item.value).join(' · ')}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2.5 rounded-xl border border-white/10 text-gray-400 text-sm hover:text-white hover:border-white/25 transition-all"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onLaunch}
              disabled={isUploading}
              className="px-6 py-2.5 rounded-xl bg-teal-500 text-black font-bold text-sm hover:bg-teal-400 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-[0.98]"
            >
              {isUploading ? 'Loading…' : researchSeed ? 'Launch with research' : 'Launch Ad Creator'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};

export default AdCreatorStudio;
