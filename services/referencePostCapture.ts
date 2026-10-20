/**
 * Capture Instagram / reference post URLs into CreativeReferenceUpload stills
 * via the agent-shell screenshot endpoint (carousel slides or best-effort Reel frames).
 */
import type { CreativeReferenceUpload } from './creativeReferenceDirector';
import { SHELL_SERVER as SHELL_SERVER_URL } from './shellToolService';

export interface CapturedReferenceShot {
  base64: string;
  mimeType: string;
  slideNumber: number;
  label?: string;
}

export interface ReferenceScreenshotResult {
  screenshots: CapturedReferenceShot[];
  count: number;
  url: string;
  kind?: string;
  partial?: boolean;
  warning?: string;
}

export interface ReferenceCaptureResult {
  uploads: CreativeReferenceUpload[];
  warning?: string;
  kind?: string;
  partial?: boolean;
  url: string;
}

export function isInstagramReelUrl(url: string): boolean {
  return /instagram\.com\/(reel|reels)\//i.test(url || '');
}

/** Instagram /reels/CODE must become /reel/CODE for embed capture. */
export function normalizeInstagramReferenceUrl(url: string): string {
  const trimmed = (url || '').trim();
  try {
    const u = new URL(trimmed);
    if (!/instagram\.com/i.test(u.hostname)) return trimmed;
    u.pathname = u.pathname.replace(/\/reels\//i, '/reel/');
    u.search = '';
    u.hash = '';
    return u.toString();
  } catch {
    return trimmed.replace(/\/reels\//i, '/reel/');
  }
}

export function isLikelyReferencePostUrl(url: string): boolean {
  const u = (url || '').trim();
  if (!/^https?:\/\//i.test(u)) return false;
  return /instagram\.com|tiktok\.com|youtube\.com|youtu\.be|facebook\.com|fb\.watch/i.test(u);
}

async function isShellAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${SHELL_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function fetchReferenceScreenshots(
  url: string,
  maxSlides = 10,
): Promise<ReferenceScreenshotResult> {
  const response = await fetch(`${SHELL_SERVER_URL}/screenshot-carousel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, maxSlides }),
  });
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error
      || `Screenshot capture failed (HTTP ${response.status}). Make sure the agent shell server is running on port 3721.`,
    );
  }
  return response.json();
}

function structureNote(kind: string | undefined, shot: CapturedReferenceShot, index: number): string {
  const n = shot.slideNumber || index + 1;
  if (kind === 'video' || shot.label?.startsWith('reel_')) {
    return `Reference structure beat ${n} (Reel frame) — match composition and pacing; do not copy other brand identity, logos, or packaging.`;
  }
  return `Reference structure beat ${n} (IG slide) — match composition and layout; do not copy other brand identity, logos, or packaging.`;
}

export function screenshotsToCreativeUploads(
  result: ReferenceScreenshotResult,
  opts?: { idPrefix?: string },
): CreativeReferenceUpload[] {
  const prefix = opts?.idPrefix || `ref_${Date.now().toString(36)}`;
  return (result.screenshots || []).map((shot, index) => {
    const n = shot.slideNumber || index + 1;
    const mime = shot.mimeType || 'image/png';
    const name = shot.label
      || (result.kind === 'video' ? `Reel frame ${n}` : `IG slide ${n}`);
    const previewUrl = `data:${mime};base64,${shot.base64}`;
    return {
      id: `${prefix}_${n}`,
      name,
      base64: shot.base64,
      mimeType: mime,
      previewUrl,
      note: structureNote(result.kind, shot, index),
    };
  });
}

/**
 * Capture a reference post URL into creative reference uploads.
 * Throws with a user-facing message when the shell is down or capture fails.
 */
export async function captureReferencePostUrl(
  url: string,
  opts?: { maxSlides?: number; existingCount?: number },
): Promise<ReferenceCaptureResult> {
  const trimmed = (url || '').trim();
  if (!trimmed) throw new Error('Paste an Instagram or reference post URL first.');
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('URL must start with https://');
  }

  const available = await isShellAvailable();
  if (!available) {
    throw new Error(
      'Agent shell server is not running (port 3721). Start it, or upload the Reel/video file instead.',
    );
  }

  const room = Math.max(1, 12 - (opts?.existingCount || 0));
  const maxSlides = Math.min(opts?.maxSlides || 10, room);
  const captureUrl = normalizeInstagramReferenceUrl(trimmed);
  const result = await fetchReferenceScreenshots(captureUrl, maxSlides);
  const uploads = screenshotsToCreativeUploads(result).slice(0, room);
  if (!uploads.length) {
    throw new Error(
      result.warning
      || 'No frames captured. The post may be private — upload the Reel/video file instead.',
    );
  }

  let warning = result.warning;
  if (result.partial && !warning) {
    warning = 'Partial capture. For better structure, upload the Reel/video file.';
  }
  if (isInstagramReelUrl(trimmed) && (result.kind !== 'video' || uploads.length < 2)) {
    warning = (warning ? `${warning} ` : '')
      + 'Reel capture was limited. Upload the video file for richer beat matching.';
  }

  return {
    uploads,
    warning,
    kind: result.kind,
    partial: result.partial,
    url: result.url || trimmed,
  };
}
