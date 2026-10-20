/**
 * Browser-side video → low-res stills for creative references.
 * No proxy clip is produced; Gemini only ever sees JPEG frames.
 */

import type { CreativeReferenceUpload } from './creativeReferenceDirector';

export const VIDEO_REF_MAX_LONG_EDGE = 512;
export const VIDEO_REF_JPEG_QUALITY = 0.72;
export const VIDEO_REF_MAX_FRAMES = 5;
/** Fixed sample positions as fractions of duration (start → end). */
export const VIDEO_REF_SAMPLE_FRACTIONS = [0, 0.25, 0.5, 0.75, 0.95] as const;

const VIDEO_MIME_PREFIX = 'video/';
const IMAGE_MIME_RE = /^image\/(png|jpeg|jpg|webp)$/i;

export function isVideoReferenceFile(file: File): boolean {
  if (file.type.startsWith(VIDEO_MIME_PREFIX)) return true;
  return /\.(mp4|webm|mov|m4v)$/i.test(file.name);
}

export function isImageReferenceFile(file: File): boolean {
  if (IMAGE_MIME_RE.test(file.type)) return true;
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

/**
 * Compute seek times (seconds) for a video of known duration.
 * Dedupes near-identical timestamps on very short clips.
 */
export function sampleVideoFrameTimes(
  durationSec: number,
  fractions: readonly number[] = VIDEO_REF_SAMPLE_FRACTIONS,
  maxFrames = VIDEO_REF_MAX_FRAMES,
): number[] {
  if (!Number.isFinite(durationSec) || durationSec <= 0) return [0];
  const capped = fractions.slice(0, maxFrames);
  const times = capped.map((f) => {
    const t = f * durationSec;
    // Keep a tiny epsilon off the exact end — some browsers refuse seek to duration.
    return Math.min(Math.max(0, t), Math.max(0, durationSec - 0.05));
  });
  const unique: number[] = [];
  for (const t of times) {
    const rounded = Math.round(t * 100) / 100;
    if (!unique.length || Math.abs(unique[unique.length - 1] - rounded) >= 0.08) {
      unique.push(rounded);
    }
  }
  return unique.length ? unique : [0];
}

export function scaleToLongEdge(
  width: number,
  height: number,
  maxLongEdge = VIDEO_REF_MAX_LONG_EDGE,
): { width: number; height: number } {
  const w = Math.max(1, width);
  const h = Math.max(1, height);
  const long = Math.max(w, h);
  if (long <= maxLongEdge) return { width: Math.round(w), height: Math.round(h) };
  const scale = maxLongEdge / long;
  return {
    width: Math.max(1, Math.round(w * scale)),
    height: Math.max(1, Math.round(h * scale)),
  };
}

function uid(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function loadVideoElement(objectUrl: string): Promise<HTMLVideoElement> {
  return new Promise((resolve, reject) => {
    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'auto';
    video.crossOrigin = 'anonymous';

    const onError = () => {
      cleanup();
      reject(new Error(
        'Could not decode this video in the browser. Try MP4 (H.264) or WebM — iPhone HEVC .mov often fails.',
      ));
    };
    const onReady = () => {
      cleanup();
      if (!video.videoWidth || !video.videoHeight) {
        reject(new Error('Video has no visual track to sample.'));
        return;
      }
      resolve(video);
    };
    const cleanup = () => {
      video.removeEventListener('loadeddata', onReady);
      video.removeEventListener('error', onError);
    };

    video.addEventListener('loadeddata', onReady);
    video.addEventListener('error', onError);
    video.src = objectUrl;
    video.load();
  });
}

function seekVideo(video: HTMLVideoElement, timeSec: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const onSeeked = () => {
      cleanup();
      resolve();
    };
    const onError = () => {
      cleanup();
      reject(new Error(`Seek failed at ${timeSec.toFixed(2)}s`));
    };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
    };
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    try {
      video.currentTime = timeSec;
    } catch (err) {
      cleanup();
      reject(err instanceof Error ? err : new Error(String(err)));
    }
  });
}

function captureFrame(
  video: HTMLVideoElement,
  maxLongEdge = VIDEO_REF_MAX_LONG_EDGE,
  quality = VIDEO_REF_JPEG_QUALITY,
): { base64: string; mimeType: string; previewUrl: string; width: number; height: number } {
  const { width, height } = scaleToLongEdge(video.videoWidth, video.videoHeight, maxLongEdge);
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas 2D unavailable');
  ctx.drawImage(video, 0, 0, width, height);
  const previewUrl = canvas.toDataURL('image/jpeg', quality);
  const base64 = previewUrl.split(',')[1] || '';
  if (!base64) throw new Error('Frame encode failed');
  return { base64, mimeType: 'image/jpeg', previewUrl, width, height };
}

/**
 * Sample low-res JPEG stills from a video File. Revokes the object URL when done.
 * Never base64-encodes the video itself.
 */
export async function extractVideoReferenceFrames(
  file: File,
  opts?: { maxFrames?: number; maxLongEdge?: number; jpegQuality?: number },
): Promise<CreativeReferenceUpload[]> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const video = await loadVideoElement(objectUrl);
    const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : 0;
    const times = sampleVideoFrameTimes(duration, VIDEO_REF_SAMPLE_FRACTIONS, opts?.maxFrames ?? VIDEO_REF_MAX_FRAMES);
    const stem = file.name.replace(/\.[^.]+$/, '') || 'video';
    const batchId = uid('vid');
    const frames: CreativeReferenceUpload[] = [];

    for (let i = 0; i < times.length; i++) {
      await seekVideo(video, times[i]);
      // One rAF lets the decoder paint the seeked frame before capture.
      await new Promise<void>((r) => requestAnimationFrame(() => r()));
      const shot = captureFrame(
        video,
        opts?.maxLongEdge ?? VIDEO_REF_MAX_LONG_EDGE,
        opts?.jpegQuality ?? VIDEO_REF_JPEG_QUALITY,
      );
      frames.push({
        id: `${batchId}-f${i + 1}`,
        name: `${stem}_frame${i + 1}.jpg`,
        base64: shot.base64,
        mimeType: shot.mimeType,
        previewUrl: shot.previewUrl,
        note: `Frame ${i + 1}/${times.length} from ${file.name} @ ${times[i].toFixed(1)}s · low-res sample`,
      });
    }

    video.removeAttribute('src');
    video.load();
    return frames;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
