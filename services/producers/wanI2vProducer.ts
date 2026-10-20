/**
 * Live Motion I2V producer — animate an approved still (multi-provider), then time-fit.
 * Providers: SiliconFlow Wan + fal (Seedance / Kling / Veo / Grok / Wan 2.7 / …).
 */
import { execShell, uploadBase64, type SessionInfo } from '../shellToolService';
import {
  siliconflowPollVideo,
  siliconflowSubmitVideo,
  WAN_I2V_MODEL,
  type WanImageSize,
} from '../siliconflow/client';
import {
  animateStudioStill,
  estimateStudioI2vCostUsd,
  formatStudioI2vOptionLabel,
  getStudioI2vModel,
  mapAspectToFalRatio,
  STUDIO_I2V_MODELS,
  type StudioI2vModelOption,
} from '../../components/AIImageStudio/studioAnimateService';
import type { StudioAsset } from '../../components/AIImageStudio/types';
import { timeFitClip } from './timeFitClip';

/** Default ad-agent Live Motion model (stable product-hero path). */
export const DEFAULT_LIVE_MOTION_MODEL_ID = WAN_I2V_MODEL;

const VIDEO_POLL_MAX_MS = 12 * 60 * 1000;
const VIDEO_POLL_EVERY_MS = 5_000;

export { STUDIO_I2V_MODELS as LIVE_MOTION_I2V_MODELS };
export type { StudioI2vModelOption as LiveMotionI2vModelOption };

/** Soft negatives — avoid banning hands/faces (lifestyle stills often include them). */
const DEFAULT_NEGATIVE_PROMPT =
  'camera shake, morphing product, warped logo, garbled text, watermark, new brands, heavy distortion';

export interface WanI2vCostEstimate {
  sceneCount: number;
  estimatedUsd: number;
  warning: string;
}

export interface WanI2vClipResult {
  sceneIndex: number;
  rawClipPath: string;
  fittedClipPath: string;
  requestId: string;
  sourceDurationSec: number;
  fittedDurationSec: number;
  strategy: string;
}

export function resolveLiveMotionModelId(modelId?: string): string {
  const id = (modelId || DEFAULT_LIVE_MOTION_MODEL_ID).trim();
  return getStudioI2vModel(id).id;
}

export function estimateLiveMotionCostPerClipUsd(
  modelId?: string,
  durationSec = 6,
): number {
  return estimateStudioI2vCostUsd(resolveLiveMotionModelId(modelId), durationSec);
}

export function estimateWanI2vCost(
  sceneCount: number,
  opts?: { modelId?: string; durationSec?: number },
): WanI2vCostEstimate {
  const n = Math.max(0, sceneCount);
  const model = getStudioI2vModel(resolveLiveMotionModelId(opts?.modelId));
  const perClip = estimateLiveMotionCostPerClipUsd(model.id, opts?.durationSec ?? 6);
  const estimatedUsd = Number((n * perClip).toFixed(2));
  return {
    sceneCount: n,
    estimatedUsd,
    warning: `Live Motion uses ${formatStudioI2vOptionLabel(model, opts?.durationSec ?? 6)}. `
      + `${n} scene(s) ≈ $${estimatedUsd.toFixed(2)}. Approve to generate.`,
  };
}

export type LiveMotionFeedbackIntent = {
  /** True when feedback clearly mentions Live Motion / Wan / animate stills. */
  matched: boolean;
  /** Target mode when matched. */
  mode: 'live_motion' | 'still';
  /** 0-based scene indexes; undefined = all scenes. */
  sceneIndexes?: number[];
};

/**
 * Parse free-text like "use live motion", "consider live motion on all scenes",
 * "animate with Wan", "ken burns only" into a motion-mode intent.
 */
export function resolveLiveMotionFromFeedback(
  feedback: string,
  sceneCount = 0,
): LiveMotionFeedbackIntent {
  const f = (feedback || '').trim();
  if (!f) return { matched: false, mode: 'still' };

  const wantsStill = /\b(ken\s*burns|still[\s-]?only|static stills|no live(?:\s*motion)?|disable live(?:\s*motion)?|without live(?:\s*motion)?)\b/i.test(f);
  const wantsLive = /\b(live\s*motion|wan(?:\s*i2v)?|i2v|animate (?:the )?(?:scenes?|stills?|video|product)|use live|enable live|with live motion|consider live|prefer live|real[\s-]?motion|video motion|make (?:it|them|scenes?) (?:live|move|animated))\b/i.test(f);

  if (!wantsLive && !wantsStill) return { matched: false, mode: 'still' };

  const mode: 'live_motion' | 'still' = wantsStill && !wantsLive ? 'still' : 'live_motion';

  // Optional: "scene 2 and 4" / "scenes 1-3"
  const indexes = new Set<number>();
  for (const m of f.matchAll(/\bscenes?\s*(\d+)(?:\s*[-–]\s*(\d+))?/gi)) {
    const a = Number(m[1]);
    const b = m[2] ? Number(m[2]) : a;
    if (!Number.isFinite(a)) continue;
    const lo = Math.min(a, b);
    const hi = Math.max(a, b);
    for (let n = lo; n <= hi; n++) {
      if (n >= 1 && (sceneCount <= 0 || n <= sceneCount)) indexes.add(n - 1);
    }
  }
  // "all scenes" / no scene numbers → apply to all
  const all = /\ball\s+scenes?\b|\bevery(?:where| scene)\b/i.test(f) || indexes.size === 0;

  return {
    matched: true,
    mode,
    sceneIndexes: all ? undefined : [...indexes].sort((a, b) => a - b),
  };
}

/** Apply Live Motion / still intent onto scene plans. Clears clips when enabling Live Motion. */
export function applyLiveMotionIntent<T extends {
  index: number;
  motionMode?: 'still' | 'live_motion';
  motionClipAbsPath?: string;
}>(scenes: T[], intent: LiveMotionFeedbackIntent): T[] {
  if (!intent.matched) return scenes;
  const target = new Set(
    intent.sceneIndexes?.length
      ? intent.sceneIndexes
      : scenes.map((s) => s.index),
  );
  return scenes.map((s) => {
    if (!target.has(s.index)) return s;
    if (intent.mode === 'live_motion') {
      return { ...s, motionMode: 'live_motion' as const, motionClipAbsPath: undefined };
    }
    return { ...s, motionMode: 'still' as const, motionClipAbsPath: undefined };
  });
}


/** Pick Wan canvas size for the ad platform (vertical Reels/TikTok/Shorts → 9:16). */
export function wanImageSizeForPlatform(platform?: string): WanImageSize {
  const p = (platform || '').toLowerCase();
  if (p.includes('tiktok') || p.includes('short') || p.includes('reel')) return '720x1280';
  if (p.includes('feed') || p.includes('carousel')) return '960x960';
  return '720x1280';
}

export function buildLiveMotionPrompt(args: {
  role: string;
  imagePrompt?: string;
  visualDescription?: string;
  /** Edit energy — bright Gen Z gets snappy dynamic motion, premium stays slow. */
  vibe?: 'gen_z_bright' | 'balanced' | 'premium_calm';
}): string {
  const beat = args.role || 'product';
  const visual = (args.visualDescription || args.imagePrompt || '').slice(0, 220);
  const motionStyle = args.vibe === 'gen_z_bright'
    ? 'Energetic snappy motion: quick camera push or lateral drift, product subtly popping with momentum, lively light shifts. Punchy but controlled.'
    : args.vibe === 'balanced'
      ? 'Confident smooth motion: steady camera push-in or drift, natural surface movement, gentle light shift.'
      : 'Slow premium motion only: gentle steam or micro surface movement, soft light shift, subtle camera push-in.';
  return [
    `Animate this approved product still for a short ${beat} ad beat.`,
    'Keep exact product identity, packaging, logo, and composition.',
    motionStyle,
    visual ? `Scene intent: ${visual}` : '',
    'No new brands, no garbled text, no medical claims.',
  ].filter(Boolean).join(' ');
}

async function fileToBase64(absPath: string, sessionDir: string): Promise<string> {
  const py = `python3 -c "import base64,sys; sys.stdout.write(base64.b64encode(open(sys.argv[1],'rb').read()).decode())" '${absPath.replace(/'/g, `'\\''`)}'`;
  const result = await execShell(py, sessionDir);
  if (!result.ok || !result.stdout.trim()) {
    throw new Error(`Failed to read still as base64: ${result.stderr.slice(-200)}`);
  }
  return result.stdout.trim();
}

async function prepWanStill(args: {
  sourcePath: string;
  outPath: string;
  sessionDir: string;
  imageSize: WanImageSize;
  /** ffmpeg -q:v (2=high quality … 8=smaller). Smaller payloads fail less often on Wan. */
  quality?: number;
}): Promise<void> {
  const [w, h] = args.imageSize.split('x').map(Number);
  const q = Math.min(8, Math.max(2, args.quality ?? 5));
  // Cover-crop into Wan's canvas — preserves subject without letterbox bars.
  const vf = `scale=${w}:${h}:force_original_aspect_ratio=increase,crop=${w}:${h}`;
  const cmd = `ffmpeg -y -i '${args.sourcePath.replace(/'/g, `'\\''`)}' -vf '${vf}' -q:v ${q} '${args.outPath.replace(/'/g, `'\\''`)}'`;
  const result = await execShell(cmd, args.sessionDir);
  if (!result.ok) throw new Error(`Still prep failed: ${result.stderr.slice(-240)}`);
}

async function probeDurationSec(absPath: string, sessionDir: string): Promise<number> {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=nk=1:nw=1 '${absPath.replace(/'/g, `'\\''`)}'`;
  const result = await execShell(cmd, sessionDir);
  const n = Number(result.stdout.trim());
  return Number.isFinite(n) && n > 0 ? n : 5.06;
}

async function downloadUrlToPath(url: string, absPath: string, sessionDir: string): Promise<void> {
  const cmd = `python3 - <<'PY'\nimport urllib.request\nurllib.request.urlretrieve(${JSON.stringify(url)}, ${JSON.stringify(absPath)})\nPY`;
  const result = await execShell(cmd, sessionDir);
  if (!result.ok) throw new Error(`Video download failed: ${result.stderr.slice(-240)}`);
}

/** True when SiliconFlow returns Failed with an empty/useless reason (common under load). */
export function isOpaqueWanFailure(message: string): boolean {
  const msg = String(message || '');
  if (/Failed with no reason|provider returned Failed|opaque wan|moderation|overload|timeout|503|429/i.test(msg)) {
    return true;
  }
  // Detail dump from poll: {"status":"Failed","reason":"",...}
  if (/"status"\s*:\s*"Failed"/i.test(msg) && (/"reason"\s*:\s*""/.test(msg) || !/"reason"\s*:\s*"[^"]+"/i.test(msg))) {
    return true;
  }
  // formatWanFail friendly copy
  if (/Wan failed \(request .+\)/i.test(msg) && /no reason|empty reason|temporary overload/i.test(msg)) {
    return true;
  }
  return false;
}

function formatWanFail(requestId: string, status: { reason?: string; detail?: string }): Error {
  const reason = (status.reason || '').trim();
  if (reason) {
    return new Error(`Wan failed (request ${requestId}): ${reason}`);
  }
  // Prefer a stable opaque marker so retries can detect this; keep a short detail slice.
  const detail = (status.detail || '').slice(0, 180);
  return new Error(
    `Wan failed (request ${requestId}): provider returned Failed with no reason`
    + (detail ? ` — ${detail}` : ' (often bad image payload, moderation, or temporary overload — retrying may help)'),
  );
}

async function pollWan(requestId: string): Promise<string> {
  const started = Date.now();
  let pollErrors = 0;
  while (Date.now() - started < VIDEO_POLL_MAX_MS) {
    let status;
    try {
      status = await siliconflowPollVideo(requestId);
      pollErrors = 0;
    } catch (err: any) {
      // Tolerate transient status-endpoint hiccups; only fail after repeats.
      pollErrors += 1;
      if (pollErrors >= 4) {
        throw new Error(`Wan status polling failed repeatedly (request ${requestId}): ${err?.message || err}`);
      }
      await new Promise((r) => setTimeout(r, VIDEO_POLL_EVERY_MS));
      continue;
    }
    if (status.status === 'Succeed') {
      if (!status.videoUrl) throw new Error(`Wan succeeded but returned no video URL (request ${requestId})`);
      return status.videoUrl;
    }
    if (status.status === 'Failed' || status.status === 'failed') {
      throw formatWanFail(requestId, status);
    }
    await new Promise((r) => setTimeout(r, VIDEO_POLL_EVERY_MS));
  }
  throw new Error(`Wan timed out after ${Math.round(VIDEO_POLL_MAX_MS / 60000)}min (request ${requestId})`);
}

async function submitAndPoll(args: {
  modelId: string;
  prompt: string;
  imageBase64: string;
  imageSize: WanImageSize;
  negativePrompt?: string;
  seed?: number;
}): Promise<{ requestId: string; videoUrl: string }> {
  const { requestId } = await siliconflowSubmitVideo({
    model: args.modelId,
    prompt: args.prompt,
    imageBase64: args.imageBase64,
    imageMimeType: 'image/jpeg',
    imageSize: args.imageSize,
    negativePrompt: args.negativePrompt ?? DEFAULT_NEGATIVE_PROMPT,
    seed: args.seed,
  });
  const videoUrl = await pollWan(requestId);
  return { requestId, videoUrl };
}

function falAspectForPlatform(platform?: string): 'auto' | '16:9' | '9:16' {
  const size = wanImageSizeForPlatform(platform);
  if (size === '1280x720') return '16:9';
  if (size === '720x1280') return '9:16';
  return mapAspectToFalRatio(size === '960x960' ? '1:1' : '9:16');
}

async function animateViaStudioProvider(args: {
  modelId: string;
  imageBase64: string;
  mimeType: string;
  prompt: string;
  negativePrompt: string;
  imageSize: WanImageSize;
  durationSec: number;
  generateAudio: boolean;
  platform?: string;
}): Promise<{ requestId: string; videoUrl: string; modelLabel: string }> {
  const model = getStudioI2vModel(args.modelId);
  const mimeType: StudioAsset['mimeType'] = args.mimeType.includes('png')
    ? 'image/png'
    : args.mimeType.includes('webp')
      ? 'image/webp'
      : 'image/jpeg';
  const asset: StudioAsset = {
    id: 'live-motion-still',
    name: 'Live Motion still',
    description: '',
    base64: args.imageBase64,
    mimeType,
    width: 0,
    height: 0,
    source: 'upload',
    createdAt: new Date().toISOString(),
  };
  const result = await animateStudioStill({
    asset,
    prompt: args.prompt,
    model: model.id,
    imageSize: args.imageSize,
    negativePrompt: args.negativePrompt,
    durationSec: args.durationSec,
    generateAudio: args.generateAudio,
    aspectRatio: falAspectForPlatform(args.platform),
  });
  return {
    requestId: result.requestId,
    videoUrl: result.videoUrl,
    modelLabel: model.label,
  };
}

/**
 * Animate one still with Live Motion I2V (SiliconFlow or fal) and time-fit.
 */
export async function generateWanI2vClip(args: {
  sceneIndex: number;
  stillAbsPath?: string;
  stillBase64?: string;
  stillMimeType?: string;
  motionPrompt: string;
  targetDurationSec: number;
  session: SessionInfo;
  imageSize?: WanImageSize;
  /** Studio / fal / SiliconFlow model id. Defaults to Wan 2.2. */
  modelId?: string;
  /** Platform for aspect hints (fal). */
  platform?: string;
  generateAudio?: boolean;
}): Promise<WanI2vClipResult> {
  const D = args.session.sessionDir;
  const imageSize = args.imageSize || '720x1280';
  const model = getStudioI2vModel(resolveLiveMotionModelId(args.modelId));
  let sourcePath = args.stillAbsPath;

  if (!sourcePath) {
    if (!args.stillBase64) throw new Error(`Scene ${args.sceneIndex + 1}: no still for Live Motion`);
    const mime = args.stillMimeType || 'image/jpeg';
    const ext = mime.includes('png') ? 'png' : 'jpg';
    const up = await uploadBase64(
      args.stillBase64.replace(/^data:[^;]+;base64,/, ''),
      `live_motion_src_${args.sceneIndex}.${ext}`,
      mime,
      D,
    );
    sourcePath = up.path;
  }

  const stillPath = `${D}/live_motion_${args.sceneIndex}_${imageSize}.jpg`;
  await prepWanStill({
    sourcePath,
    outPath: stillPath,
    sessionDir: D,
    imageSize,
    quality: 5,
  });
  let imageBase64 = await fileToBase64(stillPath, D);
  if (imageBase64.length < 1000) {
    throw new Error(`Scene ${args.sceneIndex + 1}: prepared still is suspiciously small (${imageBase64.length} chars)`);
  }
  // Cap payload size — huge JPEGs often opaque-fail on SiliconFlow.
  if (imageBase64.length > 1_800_000) {
    const compactPath = `${D}/live_motion_${args.sceneIndex}_${imageSize}_compact.jpg`;
    await prepWanStill({
      sourcePath,
      outPath: compactPath,
      sessionDir: D,
      imageSize,
      quality: 7,
    });
    imageBase64 = await fileToBase64(compactPath, D);
  }

  const simplifiedPrompt = [
    'Animate this product still with a gentle camera push-in and soft light movement.',
    'Keep exact product identity, packaging, and logo. No new brands, no garbled text.',
  ].join(' ');

  let requestId = '';
  let videoUrl = '';
  let lastErr: Error | null = null;

  if (model.provider === 'fal') {
    try {
      const result = await animateViaStudioProvider({
        modelId: model.id,
        imageBase64,
        mimeType: 'image/jpeg',
        prompt: args.motionPrompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        imageSize,
        durationSec: Math.max(
          model.minDurationSec || 4,
          Math.min(model.maxDurationSec || 15, Math.round(args.targetDurationSec || model.defaultDurationSec || 6)),
        ),
        generateAudio: args.generateAudio !== false,
        platform: args.platform,
      });
      requestId = result.requestId;
      videoUrl = result.videoUrl;
    } catch (err: any) {
      lastErr = err instanceof Error ? err : new Error(String(err));
      throw lastErr;
    }
  } else {
    const attempts: Array<{
      prompt: string;
      negativePrompt: string;
      seed?: number;
      delayMs: number;
      recompress?: boolean;
    }> = [
      {
        prompt: args.motionPrompt,
        negativePrompt: DEFAULT_NEGATIVE_PROMPT,
        delayMs: 0,
      },
      {
        prompt: simplifiedPrompt,
        negativePrompt: 'warped logo, garbled text, watermark, new brands',
        seed: 42 + args.sceneIndex,
        delayMs: 10_000,
      },
      {
        prompt: simplifiedPrompt,
        negativePrompt: 'warped logo, garbled text, watermark',
        seed: 1000 + args.sceneIndex * 17,
        delayMs: 15_000,
        recompress: true,
      },
    ];

    for (let i = 0; i < attempts.length; i++) {
      const attempt = attempts[i];
      if (attempt.delayMs > 0) {
        await new Promise((r) => setTimeout(r, attempt.delayMs));
      }
      if (attempt.recompress) {
        const retryPath = `${D}/live_motion_${args.sceneIndex}_${imageSize}_retry.jpg`;
        await prepWanStill({
          sourcePath,
          outPath: retryPath,
          sessionDir: D,
          imageSize,
          quality: 8,
        });
        imageBase64 = await fileToBase64(retryPath, D);
      }
      try {
        const result = await submitAndPoll({
          modelId: model.id,
          prompt: attempt.prompt,
          imageBase64,
          imageSize,
          negativePrompt: attempt.negativePrompt,
          seed: attempt.seed,
        });
        requestId = result.requestId;
        videoUrl = result.videoUrl;
        lastErr = null;
        break;
      } catch (err: any) {
        lastErr = err instanceof Error ? err : new Error(String(err));
        const msg = lastErr.message;
        const opaque = isOpaqueWanFailure(msg);
        const hasMore = i < attempts.length - 1;
        if (!opaque || !hasMore) throw lastErr;
      }
    }
  }

  if (lastErr || !videoUrl) {
    throw lastErr || new Error(`${model.label} failed for scene ${args.sceneIndex + 1} with no video`);
  }

  const rawClipPath = `${D}/live_motion_${args.sceneIndex}_raw.mp4`;
  await downloadUrlToPath(videoUrl, rawClipPath, D);
  const sourceDurationSec = await probeDurationSec(rawClipPath, D);

  const fittedClipPath = `${D}/live_motion_${args.sceneIndex}_fit.mp4`;
  const fitted = await timeFitClip({
    inputPath: rawClipPath,
    outputPath: fittedClipPath,
    sourceDurationSec,
    targetDurationSec: args.targetDurationSec,
    sessionDir: D,
  });

  return {
    sceneIndex: args.sceneIndex,
    rawClipPath,
    fittedClipPath,
    requestId,
    sourceDurationSec,
    fittedDurationSec: fitted.durationSec,
    strategy: fitted.strategy,
  };
}

