import React, { useCallback, useEffect, useMemo, useState } from 'react';
import type { WanImageSize } from '../../services/siliconflow/client';
import { getSiliconFlowHealth } from '../../services/siliconflow/client';
import type { StudioAsset } from './types';
import { resolveStudioAssetSrc } from './utils';
import { generateMotionPrompt } from './motionPromptService';
import {
  animateStudioStill,
  downloadStudioVideo,
  estimateStudioI2vCostUsd,
  formatStudioI2vOptionLabel,
  getStudioI2vModel,
  mapAspectToWanSize,
  STUDIO_I2V_MODELS,
  STUDIO_MOTION_STYLE_PRESETS,
  studioAnimateCostWarning,
  studioI2vProviderLabel,
  type AnimateStudioStillResult,
  type StudioAnimateProgress,
} from './studioAnimateService';

export interface VideoStudioPanelProps {
  asset: StudioAsset;
  onClose: () => void;
}

const DURATION_OPTIONS = [
  { value: 4, label: '4s' },
  { value: 5, label: '5s' },
  { value: 6, label: '6s' },
  { value: 8, label: '8s' },
  { value: 10, label: '10s' },
  { value: 12, label: '12s' },
  { value: 15, label: '15s' },
];

const SIMPLE_PRESET = STUDIO_MOTION_STYLE_PRESETS[0];

const VideoStudioPanel: React.FC<VideoStudioPanelProps> = ({ asset, onClose }) => {
  const [modelId, setModelId] = useState(SIMPLE_PRESET.suggestedModelId);
  const [motionPrompt, setMotionPrompt] = useState(SIMPLE_PRESET.motionPrompt);
  const [negativePrompt, setNegativePrompt] = useState(SIMPLE_PRESET.negativePrompt);
  const [intent, setIntent] = useState(SIMPLE_PRESET.intent);
  const [stylePresetId, setStylePresetId] = useState<string>(SIMPLE_PRESET.id);
  const [referenceUrl, setReferenceUrl] = useState('');
  const [durationSec, setDurationSec] = useState(5);
  const [generateAudio, setGenerateAudio] = useState(true);
  const [imageSize, setImageSize] = useState<WanImageSize>(() => mapAspectToWanSize(asset.aspectRatio));
  const [sfOk, setSfOk] = useState<boolean | null>(null);
  const [falOk, setFalOk] = useState<boolean | null>(null);
  const [shellOk, setShellOk] = useState<boolean | null>(null);
  const [isPrompting, setIsPrompting] = useState(false);
  const [isAnimating, setIsAnimating] = useState(false);
  const [progress, setProgress] = useState<StudioAnimateProgress | null>(null);
  const [result, setResult] = useState<AnimateStudioStillResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [promptNote, setPromptNote] = useState<string | null>(null);

  const model = useMemo(() => getStudioI2vModel(modelId), [modelId]);
  const stillSrc = resolveStudioAssetSrc(asset);
  const costUsd = estimateStudioI2vCostUsd(modelId, durationSec);

  useEffect(() => {
    setImageSize(mapAspectToWanSize(asset.aspectRatio));
    setResult(null);
    setError(null);
    setProgress(null);
  }, [asset.id, asset.aspectRatio]);

  // Remap removed/invalid fal model ids (e.g. invented Grok /fast path) onto a live catalog entry.
  useEffect(() => {
    const resolved = getStudioI2vModel(modelId);
    if (resolved.id !== modelId) setModelId(resolved.id);
  }, [modelId]);

  useEffect(() => {
    const defaultDur = getStudioI2vModel(modelId).defaultDurationSec || 6;
    setDurationSec(defaultDur);
  }, [modelId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const health = await getSiliconFlowHealth();
      if (cancelled) return;
      setShellOk(health.ok);
      setSfOk(health.siliconflowConfigured);
      setFalOk(health.falConfigured);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleApplyStylePreset = useCallback((presetId: string) => {
    const preset = STUDIO_MOTION_STYLE_PRESETS.find((p) => p.id === presetId);
    if (!preset) return;
    setStylePresetId(preset.id);
    setIntent(preset.intent);
    setMotionPrompt(preset.motionPrompt);
    setNegativePrompt(preset.negativePrompt);
    if (preset.suggestedModelId) {
      setModelId(preset.suggestedModelId);
    }
    setPromptNote(
      preset.id === 'simple'
        ? 'Simple animation — subtle motion only. Suggested cheap/fast model selected.'
        : `Style: ${preset.label}`,
    );
  }, []);

  const handleGeneratePrompt = useCallback(async () => {
    setIsPrompting(true);
    setError(null);
    setPromptNote(null);
    try {
      const out = await generateMotionPrompt({
        asset,
        intent,
        referenceUrl: referenceUrl.trim() || undefined,
      });
      setMotionPrompt(out.motionPrompt);
      setNegativePrompt(out.negativePrompt);
      setPromptNote(
        [
          out.rationale,
          out.referenceFrameCount > 0 ? `${out.referenceFrameCount} reference frame(s) used` : null,
        ]
          .filter(Boolean)
          .join(' · ') || 'Motion prompt ready',
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Motion prompt failed');
    } finally {
      setIsPrompting(false);
    }
  }, [asset, intent, referenceUrl]);

  const handleAnimate = useCallback(async () => {
    if (isAnimating || !stillSrc) return;
    if (!window.confirm(studioAnimateCostWarning(modelId, durationSec))) return;

    setIsAnimating(true);
    setError(null);
    setResult(null);
    setProgress({ stage: 'checking', message: 'Checking providers…' });
    try {
      const out = await animateStudioStill({
        asset,
        prompt: motionPrompt,
        negativePrompt,
        model: modelId,
        imageSize,
        durationSec,
        generateAudio,
        onProgress: setProgress,
      });
      setResult(out);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Animate failed');
      setProgress({ stage: 'failed', message: 'Animate failed' });
    } finally {
      setIsAnimating(false);
    }
  }, [
    isAnimating,
    stillSrc,
    modelId,
    durationSec,
    asset,
    motionPrompt,
    negativePrompt,
    imageSize,
    generateAudio,
  ]);

  const handleDownload = useCallback(async () => {
    if (!result?.videoUrl) return;
    try {
      await downloadStudioVideo(
        result.videoUrl,
        `studio-${model.provider}-${asset.id.slice(0, 8)}-${Date.now()}.mp4`,
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Download failed');
    }
  }, [result?.videoUrl, model.provider, asset.id]);

  return (
    <div
      className="fixed inset-0 z-[90] flex flex-col bg-studio-canvas/95 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-label="Video Studio"
    >
      <header className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <p className="text-[10px] uppercase tracking-widest text-teal-200/80 font-semibold">Video Studio</p>
          <h2 className="text-sm font-semibold text-white truncate max-w-[60vw]">
            {asset.name || 'Animate still'}
          </h2>
        </div>
        <div className="flex items-center gap-2 text-[10px]">
          <span
            className={`rounded-full px-2 py-1 border ${
              shellOk ? 'border-teal-400/40 text-teal-100' : 'border-rose-400/40 text-rose-200'
            }`}
          >
            Shell {shellOk == null ? '…' : shellOk ? 'ok' : 'offline'}
          </span>
          <span
            className={`rounded-full px-2 py-1 border ${
              sfOk ? 'border-teal-400/40 text-teal-100' : 'border-white/15 text-gray-400'
            }`}
          >
            SF {sfOk == null ? '…' : sfOk ? 'ready' : 'no key'}
          </span>
          <span
            className={`rounded-full px-2 py-1 border ${
              falOk ? 'border-teal-400/40 text-teal-100' : 'border-white/15 text-gray-400'
            }`}
          >
            fal {falOk == null ? '…' : falOk ? 'ready' : 'no key'}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="ml-1 h-9 w-9 rounded-full bg-white/10 text-white hover:bg-white/20"
            aria-label="Close Video Studio"
          >
            ✕
          </button>
        </div>
      </header>

      <div className="min-h-0 flex-1 grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(320px,420px)] gap-0">
        <div className="min-h-0 flex flex-col items-center justify-center gap-3 p-4 border-b lg:border-b-0 lg:border-r border-white/10">
          {stillSrc ? (
            <img
              src={stillSrc}
              alt={asset.name || 'Still'}
              className="max-h-[42vh] lg:max-h-[55vh] w-auto max-w-full object-contain rounded-lg border border-white/10 bg-black/40"
            />
          ) : (
            <p className="text-sm text-rose-300">No image data on this still.</p>
          )}
          {result?.videoUrl && (
            <video
              key={result.videoUrl}
              src={result.videoUrl}
              controls
              playsInline
              className="max-h-[36vh] w-full max-w-2xl rounded-lg border border-white/10 bg-black object-contain"
            />
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4 space-y-4">
          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Model</span>
            <select
              value={modelId}
              onChange={(e) => setModelId(e.target.value)}
              disabled={isAnimating}
              className="w-full rounded-lg border border-white/10 bg-studio-surface px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
            >
              <optgroup label="fal.ai">
                {STUDIO_I2V_MODELS.filter((m) => m.provider === 'fal').map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatStudioI2vOptionLabel(m, durationSec)}
                  </option>
                ))}
              </optgroup>
              <optgroup label="SiliconFlow">
                {STUDIO_I2V_MODELS.filter((m) => m.provider === 'siliconflow').map((m) => (
                  <option key={m.id} value={m.id}>
                    {formatStudioI2vOptionLabel(m, durationSec)}
                  </option>
                ))}
              </optgroup>
            </select>
            <p className="text-[11px] text-gray-400">
              {studioI2vProviderLabel(model.provider)}
              {' · '}
              {model.provider === 'fal'
                ? `~$${costUsd.toFixed(2)}/clip at ${durationSec}s${
                    model.costPerSecUsd ? ` (~$${model.costPerSecUsd.toFixed(2)}/s)` : ''
                  }`
                : `~$${costUsd.toFixed(2)}/clip`}
              {model.description ? ` — ${model.description}` : ''}
            </p>
          </label>

          {model.provider === 'siliconflow' ? (
            <label className="block space-y-1">
              <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Wan size</span>
              <select
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value as WanImageSize)}
                disabled={isAnimating}
                className="w-full rounded-lg border border-white/10 bg-studio-surface px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
              >
                <option value="720x1280">720×1280 (vertical)</option>
                <option value="1280x720">1280×720 (landscape)</option>
                <option value="960x960">960×960 (square)</option>
              </select>
            </label>
          ) : (
            <div className="grid grid-cols-2 gap-2">
              <label className="block space-y-1">
                <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Duration</span>
                <select
                  value={durationSec}
                  onChange={(e) => setDurationSec(Number(e.target.value))}
                  disabled={isAnimating}
                  className="w-full rounded-lg border border-white/10 bg-studio-surface px-3 py-2 text-xs text-white focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
                >
                  {DURATION_OPTIONS.filter((d) => {
                    const min = model.minDurationSec || 4;
                    const max = model.maxDurationSec || 15;
                    return d.value >= min && d.value <= max;
                  }).map((d) => (
                    <option key={d.value} value={d.value}>
                      {d.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-end gap-2 pb-2 text-xs text-gray-300">
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(e) => setGenerateAudio(e.target.checked)}
                  disabled={isAnimating || !model.supportsAudio}
                  className="rounded border-white/20"
                />
                Native audio
              </label>
            </div>
          )}

          <div className="space-y-2 rounded-xl border border-white/10 bg-studio-surface/60 p-3">
            <p className="text-[10px] uppercase tracking-widest text-teal-200/80 font-semibold">
              AI motion prompt
            </p>
            <div className="flex flex-wrap gap-1.5">
              {STUDIO_MOTION_STYLE_PRESETS.map((preset) => (
                <button
                  key={preset.id}
                  type="button"
                  onClick={() => handleApplyStylePreset(preset.id)}
                  disabled={isPrompting || isAnimating}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-medium disabled:opacity-40 ${
                    stylePresetId === preset.id
                      ? 'border-studio-accent/50 bg-studio-accent/25 text-teal-50'
                      : 'border-white/15 bg-white/5 text-gray-300 hover:bg-white/10'
                  }`}
                >
                  {preset.label}
                </button>
              ))}
            </div>
            <label className="block space-y-1">
              <span className="text-[11px] text-gray-400">What should this feel like?</span>
              <textarea
                value={intent}
                onChange={(e) => {
                  setIntent(e.target.value);
                  setStylePresetId('');
                }}
                rows={2}
                disabled={isPrompting || isAnimating}
                className="w-full rounded-lg border border-white/10 bg-studio-canvas px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
                placeholder="e.g. Just subtle animation — or Instagram product ad, slow orbit"
              />
            </label>
            <label className="block space-y-1">
              <span className="text-[11px] text-gray-400">Reference URL (optional — Playwright)</span>
              <input
                type="url"
                value={referenceUrl}
                onChange={(e) => setReferenceUrl(e.target.value)}
                disabled={isPrompting || isAnimating}
                className="w-full rounded-lg border border-white/10 bg-studio-canvas px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
                placeholder="https://www.instagram.com/reel/…"
              />
            </label>
            <button
              type="button"
              onClick={() => void handleGeneratePrompt()}
              disabled={isPrompting || isAnimating || !stillSrc}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-gray-100 hover:bg-white/10 disabled:opacity-40"
            >
              {isPrompting ? 'Writing motion prompt…' : 'Generate motion prompt'}
            </button>
            {promptNote && <p className="text-[11px] text-teal-200/90">{promptNote}</p>}
          </div>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Motion prompt</span>
            <textarea
              value={motionPrompt}
              onChange={(e) => setMotionPrompt(e.target.value)}
              rows={4}
              disabled={isAnimating}
              className="w-full rounded-lg border border-white/10 bg-studio-surface px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
            />
          </label>

          <label className="block space-y-1">
            <span className="text-[10px] uppercase tracking-widest text-gray-500 font-semibold">Negative prompt</span>
            <textarea
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              rows={2}
              disabled={isAnimating}
              className="w-full rounded-lg border border-white/10 bg-studio-surface px-3 py-2 text-xs text-gray-100 focus:outline-none focus:ring-1 focus:ring-studio-accent disabled:opacity-50"
            />
          </label>

          {(progress || error) && (
            <p
              className={`text-[11px] ${
                error || progress?.stage === 'failed'
                  ? 'text-rose-300'
                  : progress?.stage === 'done'
                    ? 'text-teal-200'
                    : 'text-gray-300'
              }`}
            >
              {error || progress?.message}
            </p>
          )}

          <button
            type="button"
            onClick={() => void handleAnimate()}
            disabled={isAnimating || !stillSrc}
            className="w-full rounded-lg border border-studio-accent/40 bg-studio-accent/25 px-3 py-2.5 text-xs font-semibold text-teal-50 hover:bg-studio-accent/35 disabled:opacity-40"
          >
            {isAnimating ? 'Animating…' : `Animate (~$${costUsd.toFixed(2)})`}
          </button>

          {result?.videoUrl && (
            <button
              type="button"
              onClick={() => void handleDownload()}
              className="w-full rounded-lg border border-white/15 bg-white/5 px-3 py-2 text-xs font-medium text-gray-100 hover:bg-white/10"
            >
              Download MP4
              {typeof result.elapsedMs === 'number'
                ? ` · ${Math.round(result.elapsedMs / 1000)}s`
                : ''}
            </button>
          )}

          <p className="text-[10px] text-gray-500 leading-relaxed">
            Clips are previewed here only — not saved to the Image Studio gallery. fal keys stay on the agent shell.
          </p>
        </div>
      </div>
    </div>
  );
};

export default VideoStudioPanel;
