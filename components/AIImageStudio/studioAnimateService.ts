/**
 * Image Studio / Video Studio — multi-provider still → MP4 (SiliconFlow Wan + fal Veo/Kling).
 * Keys stay on the agent shell harness proxy.
 */
import type { AspectRatio, StudioAsset } from './types';
import {
  getSiliconFlowHealth,
  siliconflowPollVideo,
  siliconflowSubmitVideo,
  WAN_I2V_MODEL,
  WAN_I2V_TURBO_MODEL,
  type WanImageSize,
} from '../../services/siliconflow/client';
import {
  FAL_HAPPY_HORSE_I2V,
  FAL_KLING_26_PRO_I2V,
  FAL_KLING_30_PRO_I2V,
  FAL_GROK_IMAGINE_15_I2V,
  FAL_GROK_IMAGINE_I2V,
  FAL_SEEDANCE_20_FAST_I2V,
  FAL_SEEDANCE_20_I2V,
  FAL_SEEDANCE_20_MINI_I2V,
  FAL_VEO31_FAST_I2V,
  FAL_VEO31_I2V,
  FAL_VEO31_LITE_I2V,
  FAL_WAN_27_I2V,
  falPollVideo,
  falSubmitVideo,
  falUploadImage,
  getFalHealth,
} from '../../services/fal/client';

export type StudioI2vProvider = 'siliconflow' | 'fal';
export type StudioFalImageField = 'image_url' | 'start_image_url';
/** How fal expects duration encoded in the JSON payload. */
export type StudioFalDurationStyle = 'veo_s' | 'kling' | 'seedance' | 'seconds' | 'integer';

export interface StudioI2vModelOption {
  id: string;
  label: string;
  provider: StudioI2vProvider;
  /** Flat clip cost when known (Wan SiliconFlow). */
  costHintUsd?: number;
  /** Per-second estimate (fal, typically with audio on). */
  costPerSecUsd?: number;
  falModel?: string;
  imageField?: StudioFalImageField;
  durationStyle?: StudioFalDurationStyle;
  defaultDurationSec?: number;
  minDurationSec?: number;
  maxDurationSec?: number;
  supportsDuration?: boolean;
  supportsAudio?: boolean;
  supportsAspectRatio?: boolean;
  supportsResolution?: boolean;
  description?: string;
}

export const STUDIO_I2V_MODELS: StudioI2vModelOption[] = [
  {
    id: FAL_SEEDANCE_20_I2V,
    label: 'Seedance 2.0',
    provider: 'fal',
    falModel: FAL_SEEDANCE_20_I2V,
    imageField: 'image_url',
    durationStyle: 'seedance',
    costPerSecUsd: 0.3,
    defaultDurationSec: 5,
    minDurationSec: 4,
    maxDurationSec: 15,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'ByteDance — top cinematic I2V with native audio',
  },
  {
    id: FAL_SEEDANCE_20_FAST_I2V,
    label: 'Seedance 2.0 Fast',
    provider: 'fal',
    falModel: FAL_SEEDANCE_20_FAST_I2V,
    imageField: 'image_url',
    durationStyle: 'seedance',
    costPerSecUsd: 0.24,
    defaultDurationSec: 5,
    minDurationSec: 4,
    maxDurationSec: 15,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'ByteDance — same Seedance quality tier, lower latency/cost',
  },
  {
    id: FAL_SEEDANCE_20_MINI_I2V,
    label: 'Seedance 2.0 Mini',
    provider: 'fal',
    falModel: FAL_SEEDANCE_20_MINI_I2V,
    imageField: 'image_url',
    durationStyle: 'seedance',
    costPerSecUsd: 0.15,
    defaultDurationSec: 5,
    minDurationSec: 4,
    maxDurationSec: 15,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'ByteDance — fast/cheap Seedance for drafts',
  },
  {
    id: FAL_KLING_30_PRO_I2V,
    label: 'Kling 3.0 Pro',
    provider: 'fal',
    falModel: FAL_KLING_30_PRO_I2V,
    imageField: 'start_image_url',
    durationStyle: 'kling',
    costPerSecUsd: 0.17,
    defaultDurationSec: 5,
    minDurationSec: 5,
    maxDurationSec: 10,
    supportsDuration: true,
    supportsAudio: true,
    description: 'Kling — current top-tier motion + native audio',
  },
  {
    id: FAL_KLING_26_PRO_I2V,
    label: 'Kling 2.6 Pro',
    provider: 'fal',
    falModel: FAL_KLING_26_PRO_I2V,
    imageField: 'start_image_url',
    durationStyle: 'kling',
    costPerSecUsd: 0.14,
    defaultDurationSec: 5,
    minDurationSec: 5,
    maxDurationSec: 10,
    supportsDuration: true,
    supportsAudio: true,
    description: 'Kling — strong product ads, packaging-friendly',
  },
  {
    id: FAL_HAPPY_HORSE_I2V,
    label: 'Happy Horse',
    provider: 'fal',
    falModel: FAL_HAPPY_HORSE_I2V,
    imageField: 'image_url',
    durationStyle: 'seconds',
    costPerSecUsd: 0.14,
    defaultDurationSec: 5,
    minDurationSec: 3,
    maxDurationSec: 15,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    description: 'Alibaba — high Elo quality, 1080p + lip-sync',
  },
  {
    id: FAL_GROK_IMAGINE_I2V,
    label: 'Grok Imagine',
    provider: 'fal',
    falModel: FAL_GROK_IMAGINE_I2V,
    imageField: 'image_url',
    durationStyle: 'integer',
    costPerSecUsd: 0.07,
    defaultDurationSec: 6,
    minDurationSec: 1,
    maxDurationSec: 15,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'xAI — Grok Imagine I2V with native audio (~$0.05/s @480p, ~$0.07/s @720p)',
  },
  {
    id: FAL_GROK_IMAGINE_15_I2V,
    label: 'Grok Imagine 1.5',
    provider: 'fal',
    falModel: FAL_GROK_IMAGINE_15_I2V,
    imageField: 'image_url',
    durationStyle: 'integer',
    costPerSecUsd: 0.14,
    defaultDurationSec: 6,
    minDurationSec: 1,
    maxDurationSec: 15,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'xAI — Grok Imagine Video 1.5 I2V with native audio (~$0.14/s @720p)',
  },
  {
    id: FAL_VEO31_I2V,
    label: 'Veo 3.1',
    provider: 'fal',
    falModel: FAL_VEO31_I2V,
    imageField: 'image_url',
    durationStyle: 'veo_s',
    costPerSecUsd: 0.4,
    defaultDurationSec: 8,
    minDurationSec: 4,
    maxDurationSec: 8,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'Google — premium Veo with native audio',
  },
  {
    id: FAL_VEO31_FAST_I2V,
    label: 'Veo 3.1 Fast',
    provider: 'fal',
    falModel: FAL_VEO31_FAST_I2V,
    imageField: 'image_url',
    durationStyle: 'veo_s',
    costPerSecUsd: 0.15,
    defaultDurationSec: 6,
    minDurationSec: 4,
    maxDurationSec: 8,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'Google — faster / cheaper Veo for iteration',
  },
  {
    id: FAL_VEO31_LITE_I2V,
    label: 'Veo 3.1 Lite',
    provider: 'fal',
    falModel: FAL_VEO31_LITE_I2V,
    imageField: 'image_url',
    durationStyle: 'veo_s',
    costPerSecUsd: 0.12,
    defaultDurationSec: 6,
    minDurationSec: 4,
    maxDurationSec: 8,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    supportsResolution: true,
    description: 'Google — practical Veo lite tier',
  },
  {
    id: FAL_WAN_27_I2V,
    label: 'Wan 2.7',
    provider: 'fal',
    falModel: FAL_WAN_27_I2V,
    imageField: 'image_url',
    durationStyle: 'seconds',
    costPerSecUsd: 0.1,
    defaultDurationSec: 5,
    minDurationSec: 4,
    maxDurationSec: 10,
    supportsDuration: true,
    supportsAudio: true,
    supportsAspectRatio: true,
    description: 'Alibaba Wan on fal — smooth motion, latest Wan gen',
  },
  {
    id: WAN_I2V_MODEL,
    label: 'Wan 2.2 I2V',
    provider: 'siliconflow',
    costHintUsd: 0.29,
    description: 'SiliconFlow — stable product-hero motion',
  },
  {
    id: WAN_I2V_TURBO_MODEL,
    label: 'Wan 2.1 Turbo',
    provider: 'siliconflow',
    costHintUsd: 0.21,
    description: 'SiliconFlow — faster / cheaper Wan drafts',
  },
];

export function studioI2vProviderLabel(provider: StudioI2vProvider): string {
  return provider === 'fal' ? 'fal.ai' : 'SiliconFlow';
}

/** Dropdown label: "Seedance 2.0 · fal.ai · ~$1.50/clip (~$0.30/s)" */
export function formatStudioI2vOptionLabel(
  model: StudioI2vModelOption,
  durationSec?: number,
): string {
  const source = studioI2vProviderLabel(model.provider);
  const seconds = durationSec || model.defaultDurationSec || 6;
  if (typeof model.costHintUsd === 'number') {
    return `${model.label} · ${source} · ~$${model.costHintUsd.toFixed(2)}/clip`;
  }
  if (typeof model.costPerSecUsd === 'number') {
    const clip = estimateStudioI2vCostUsd(model.id, seconds);
    return `${model.label} · ${source} · ~$${clip.toFixed(2)}/clip (~$${model.costPerSecUsd.toFixed(2)}/s)`;
  }
  return `${model.label} · ${source}`;
}

export const DEFAULT_STUDIO_I2V_MODEL_ID = FAL_SEEDANCE_20_I2V;

export const STUDIO_WAN_COST_USD = 0.29;

export const DEFAULT_STUDIO_MOTION_PROMPT =
  'Subtle natural motion only — gentle camera drift or soft parallax, keep the subject sharp and unchanged, no new objects, no text changes, no dramatic effects';

export const STUDIO_MOTION_STYLE_PRESETS = [
  {
    id: 'simple',
    label: 'Just animate',
    intent: 'Just subtle animation — nothing else. No ad energy, no story. Keep everything looking like the still.',
    motionPrompt:
      'Subtle natural motion only — gentle camera drift or soft parallax, keep the subject sharp and unchanged, no new objects, no text changes, no dramatic effects',
    negativePrompt:
      'camera shake, morphing, warped logo, garbled text, new objects, dramatic zoom, action, new brands, heavy distortion',
    suggestedModelId: FAL_GROK_IMAGINE_I2V,
  },
  {
    id: 'ad',
    label: 'Product ad',
    intent: 'Instagram product ad — gentle hero push-in, packaging stays sharp',
    motionPrompt:
      'Subtle product-hero motion, gentle camera push-in, natural light, keep packaging and label readable, no new brands, no morphing logo',
    negativePrompt:
      'camera shake, morphing product, warped logo, garbled text, watermark, new brands, heavy distortion',
    suggestedModelId: FAL_SEEDANCE_20_I2V,
  },
  {
    id: 'cinematic',
    label: 'Cinematic',
    intent: 'Cinematic short — slow orbit, shallow depth, filmic light, still-faithful',
    motionPrompt:
      'Cinematic slow camera move with soft parallax and natural light falloff, preserve subject identity and any on-image text, elegant pacing',
    negativePrompt:
      'camera shake, morphing, warped logo, garbled text, new brands, jitter, overcooked VFX',
    suggestedModelId: FAL_SEEDANCE_20_I2V,
  },
] as const;

const DEFAULT_NEGATIVE_PROMPT =
  'camera shake, morphing product, warped logo, garbled text, watermark, new brands, heavy distortion';

const POLL_EVERY_MS = 5_000;
const POLL_MAX_MS = 8 * 60 * 1000;

export type StudioAnimateProgressStage =
  | 'checking'
  | 'uploading'
  | 'submitting'
  | 'generating'
  | 'done'
  | 'failed';

export interface StudioAnimateProgress {
  stage: StudioAnimateProgressStage;
  message: string;
  elapsedMs?: number;
}

export interface AnimateStudioStillInput {
  asset: StudioAsset;
  prompt?: string;
  model?: string;
  imageSize?: WanImageSize;
  negativePrompt?: string;
  /** fal duration like 4s / 6s / 8s (Veo) or numeric seconds for Kling */
  durationSec?: number;
  generateAudio?: boolean;
  aspectRatio?: 'auto' | '16:9' | '9:16';
  onProgress?: (progress: StudioAnimateProgress) => void;
  /** Injected for tests */
  submitVideo?: typeof siliconflowSubmitVideo;
  pollVideo?: typeof siliconflowPollVideo;
  getHealth?: typeof getSiliconFlowHealth;
  getFalHealthFn?: typeof getFalHealth;
  falUpload?: typeof falUploadImage;
  falSubmit?: typeof falSubmitVideo;
  falPoll?: typeof falPollVideo;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}

export interface AnimateStudioStillResult {
  videoUrl: string;
  model: string;
  provider: StudioI2vProvider;
  requestId: string;
  imageSize?: WanImageSize;
  elapsedMs: number;
  prompt: string;
  estimatedCostUsd?: number;
}

/** Stale catalog ids that never existed on fal (invented /fast and /flash paths). */
const LEGACY_GROK_I2V_ALIASES = new Set([
  'xai/grok-imagine-video/fast/image-to-video',
  'xai/grok-imagine-video/flash/image-to-video',
]);

export function getStudioI2vModel(modelId?: string): StudioI2vModelOption {
  const raw = (modelId || DEFAULT_STUDIO_I2V_MODEL_ID).trim();
  const id = LEGACY_GROK_I2V_ALIASES.has(raw) ? FAL_GROK_IMAGINE_I2V : raw;
  return STUDIO_I2V_MODELS.find((m) => m.id === id) || STUDIO_I2V_MODELS[0];
}

/** Map Image Studio aspect ratio to Wan canvas size. */
export function mapAspectToWanSize(aspectRatio?: AspectRatio | string): WanImageSize {
  const a = (aspectRatio || '').trim();
  if (a === '9:16' || a === '4:5' || a === '3:4' || a === '2:3') return '720x1280';
  if (a === '16:9' || a === '3:2') return '1280x720';
  if (a === '1:1') return '960x960';
  return '960x960';
}

export function mapAspectToFalRatio(aspectRatio?: AspectRatio | string): 'auto' | '16:9' | '9:16' {
  const a = (aspectRatio || '').trim();
  if (a === '16:9' || a === '3:2') return '16:9';
  if (a === '9:16' || a === '4:5' || a === '3:4' || a === '2:3') return '9:16';
  return 'auto';
}

export function estimateStudioI2vCostUsd(
  modelId: string,
  durationSec?: number,
): number {
  const model = getStudioI2vModel(modelId);
  if (typeof model.costHintUsd === 'number') return model.costHintUsd;
  const seconds = durationSec || model.defaultDurationSec || 6;
  if (typeof model.costPerSecUsd === 'number') {
    return Number((model.costPerSecUsd * seconds).toFixed(2));
  }
  return 0.3;
}

export function studioAnimateCostWarning(modelId?: string, durationSec?: number): string {
  const model = getStudioI2vModel(modelId);
  const cost = estimateStudioI2vCostUsd(model.id, durationSec);
  const dur =
    model.provider === 'fal'
      ? ` (~${durationSec || model.defaultDurationSec || 6}s est.)`
      : '';
  return `${model.label}${dur} is ~$${cost.toFixed(2)} per clip. Continue?`;
}

/** @deprecated use studioAnimateCostWarning */
export function studioWanCostWarning(modelLabel = 'Wan 2.2 I2V'): string {
  return `${modelLabel} image-to-video is ~$${STUDIO_WAN_COST_USD.toFixed(2)} per clip. Continue?`;
}

/** Resolve raw base64, data-URL, or public URL for provider payloads. */
export function resolveStillImagePayload(asset: Pick<StudioAsset, 'base64' | 'mimeType' | 'previewUrl'>): {
  imageBase64: string;
  mimeType: string;
} {
  const mimeType = asset.mimeType || 'image/jpeg';
  if (asset.base64?.trim()) {
    return { imageBase64: asset.base64.trim(), mimeType };
  }
  const preview = asset.previewUrl?.trim() || '';
  if (/^https?:\/\//i.test(preview) || /^data:image\//i.test(preview)) {
    return { imageBase64: preview, mimeType };
  }
  throw new Error('This still has no image data to animate. Re-import or regenerate the image first.');
}

function rawBase64ForUpload(imageBase64: string): string {
  return imageBase64.replace(/^data:[^;]+;base64,/, '').replace(/\s/g, '');
}

function durationToken(seconds: number, modelId: string): string | number {
  const model = getStudioI2vModel(modelId);
  const min = model.minDurationSec || 4;
  const max = model.maxDurationSec || 15;
  const clamped = Math.max(min, Math.min(max, Math.round(seconds)));
  const style = model.durationStyle || (model.falModel?.includes('kling') ? 'kling' : 'veo_s');

  if (style === 'integer') {
    return clamped;
  }
  if (style === 'kling' || style === 'seedance' || style === 'seconds') {
    return String(clamped);
  }

  // Veo-style: 4s / 6s / 8s
  const allowed = [4, 6, 8].filter((n) => n >= min && n <= max);
  const nearest = (allowed.length ? allowed : [4, 6, 8]).reduce((best, n) =>
    Math.abs(n - seconds) < Math.abs(best - seconds) ? n : best,
  );
  return `${nearest}s`;
}

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

async function animateViaSiliconFlow(
  input: AnimateStudioStillInput,
  model: StudioI2vModelOption,
): Promise<AnimateStudioStillResult> {
  const getHealth = input.getHealth || getSiliconFlowHealth;
  const submitVideo = input.submitVideo || siliconflowSubmitVideo;
  const pollVideo = input.pollVideo || siliconflowPollVideo;
  const sleep = input.sleep || defaultSleep;
  const now = input.now || Date.now;

  input.onProgress?.({
    stage: 'checking',
    message: 'Checking SiliconFlow / agent shell…',
  });

  const health = await getHealth();
  if (!health.ok) {
    throw new Error(
      'Agent shell is offline (port 3721). Start it with npm run agent:server, then retry.',
    );
  }
  if (!health.siliconflowConfigured) {
    throw new Error(
      'SiliconFlow is not configured on the agent shell. Set SILICONFLOW_API_KEY and restart npm run agent:server.',
    );
  }

  const imageSize = input.imageSize || mapAspectToWanSize(input.asset.aspectRatio);
  const prompt = (input.prompt || '').trim() || DEFAULT_STUDIO_MOTION_PROMPT;
  const negativePrompt = (input.negativePrompt || '').trim() || DEFAULT_NEGATIVE_PROMPT;
  const { imageBase64, mimeType } = resolveStillImagePayload(input.asset);

  input.onProgress?.({
    stage: 'submitting',
    message: `Submitting still to ${model.label}…`,
  });

  const started = now();
  const { requestId } = await submitVideo({
    model: model.id,
    prompt,
    imageBase64,
    imageMimeType: mimeType,
    imageSize,
    negativePrompt,
  });

  input.onProgress?.({
    stage: 'generating',
    message: 'Generating motion clip…',
    elapsedMs: 0,
  });

  while (now() - started < POLL_MAX_MS) {
    const status = await pollVideo(requestId);
    const elapsedMs = now() - started;
    if (status.status === 'Succeed') {
      if (!status.videoUrl) throw new Error('Wan finished but returned no video URL');
      input.onProgress?.({ stage: 'done', message: 'Clip ready', elapsedMs });
      return {
        videoUrl: status.videoUrl,
        model: model.id,
        provider: 'siliconflow',
        requestId,
        imageSize,
        elapsedMs,
        prompt,
        estimatedCostUsd: estimateStudioI2vCostUsd(model.id),
      };
    }
    if (/fail/i.test(status.status || '')) {
      throw new Error(status.reason || status.detail || 'Wan I2V generation failed');
    }
    input.onProgress?.({
      stage: 'generating',
      message: `Generating… (${status.status || 'queued'}, ${Math.round(elapsedMs / 1000)}s)`,
      elapsedMs,
    });
    await sleep(POLL_EVERY_MS);
  }

  throw new Error('Wan I2V timed out after 8 minutes. Try again, or use a smaller still.');
}

async function animateViaFal(
  input: AnimateStudioStillInput,
  model: StudioI2vModelOption,
): Promise<AnimateStudioStillResult> {
  const getHealth = input.getFalHealthFn || getFalHealth;
  const upload = input.falUpload || falUploadImage;
  const submit = input.falSubmit || falSubmitVideo;
  const poll = input.falPoll || falPollVideo;
  const sleep = input.sleep || defaultSleep;
  const now = input.now || Date.now;

  const falModel = model.falModel || model.id;
  const durationSec = input.durationSec || model.defaultDurationSec || 6;
  const prompt = (input.prompt || '').trim() || DEFAULT_STUDIO_MOTION_PROMPT;
  const negativePrompt = (input.negativePrompt || '').trim() || DEFAULT_NEGATIVE_PROMPT;
  const generateAudio = input.generateAudio !== false;
  const aspectRatio = input.aspectRatio || mapAspectToFalRatio(input.asset.aspectRatio);

  input.onProgress?.({
    stage: 'checking',
    message: 'Checking fal.ai / agent shell…',
  });

  const health = await getHealth();
  if (!health.ok) {
    throw new Error(
      'Agent shell is offline (port 3721). Start it with npm run agent:server, then retry.',
    );
  }
  if (!health.falConfigured) {
    throw new Error(
      'fal.ai is not configured on the agent shell. Set FAL_KEY in the shell env and restart npm run agent:server.',
    );
  }

  const { imageBase64, mimeType } = resolveStillImagePayload(input.asset);

  let imageUrl: string;
  if (/^https?:\/\//i.test(imageBase64)) {
    imageUrl = imageBase64;
  } else {
    input.onProgress?.({
      stage: 'uploading',
      message: 'Uploading still to fal CDN…',
    });
    const uploaded = await upload({
      base64: rawBase64ForUpload(imageBase64),
      mimeType,
    });
    imageUrl = uploaded.url;
  }

  const imageField = model.imageField || 'image_url';
  const falInput: Record<string, unknown> = {
    prompt,
    [imageField]: imageUrl,
  };
  if (model.supportsDuration) {
    falInput.duration = durationToken(durationSec, model.id);
  }
  if (model.supportsAudio) {
    falInput.generate_audio = generateAudio;
  }
  if (model.supportsAspectRatio) {
    falInput.aspect_ratio = aspectRatio === 'auto' ? 'auto' : aspectRatio;
  }
  if (model.supportsResolution) {
    falInput.resolution = '720p';
  }
  if (falModel.includes('veo') && negativePrompt) {
    falInput.negative_prompt = negativePrompt;
  }

  input.onProgress?.({
    stage: 'submitting',
    message: `Submitting to ${model.label}…`,
  });

  const started = now();
  const { requestId, statusUrl, responseUrl } = await submit({
    model: falModel,
    input: falInput,
  });

  input.onProgress?.({
    stage: 'generating',
    message: 'Generating motion clip…',
    elapsedMs: 0,
  });

  while (now() - started < POLL_MAX_MS) {
    const status = await poll({
      model: falModel,
      requestId,
      statusUrl,
      responseUrl,
    });
    const elapsedMs = now() - started;
    if (status.status === 'COMPLETED') {
      if (!status.videoUrl) {
        throw new Error(status.detail || 'fal finished but returned no video URL');
      }
      input.onProgress?.({ stage: 'done', message: 'Clip ready', elapsedMs });
      return {
        videoUrl: status.videoUrl,
        model: model.id,
        provider: 'fal',
        requestId,
        elapsedMs,
        prompt,
        estimatedCostUsd: estimateStudioI2vCostUsd(model.id, durationSec),
      };
    }
    if (/fail|error/i.test(status.status || '')) {
      throw new Error(status.detail || `fal generation failed (${status.status})`);
    }
    input.onProgress?.({
      stage: 'generating',
      message: `Generating… (${status.status || 'queued'}, ${Math.round(elapsedMs / 1000)}s)`,
      elapsedMs,
    });
    await sleep(POLL_EVERY_MS);
  }

  throw new Error('fal generation timed out after 8 minutes. Try Veo Fast or a shorter duration.');
}

/**
 * Animate a studio still via SiliconFlow Wan or fal (Veo / Kling).
 */
export async function animateStudioStill(
  input: AnimateStudioStillInput,
): Promise<AnimateStudioStillResult> {
  const model = getStudioI2vModel(input.model);
  if (model.provider === 'fal') {
    return animateViaFal(input, model);
  }
  return animateViaSiliconFlow(input, model);
}

/** Fetch remote MP4 and trigger a browser download. */
export async function downloadStudioVideo(
  videoUrl: string,
  filename = `studio-i2v-${Date.now()}.mp4`,
): Promise<void> {
  const res = await fetch(videoUrl);
  if (!res.ok) throw new Error(`Could not download video (${res.status})`);
  const blob = await res.blob();
  const objectUrl = URL.createObjectURL(blob);
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    a.rel = 'noopener';
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
