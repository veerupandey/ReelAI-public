/**
 * Screenshot Service — calls the agent-shell-server's /screenshot-carousel endpoint
 * to capture carousel slides / best-effort Reel frames from a post URL using Playwright.
 *
 * Falls back gracefully if the shell server is not running.
 */

import { normalizeInstagramReferenceUrl } from '../../services/referencePostCapture';
import { SHELL_SERVER } from '../../services/shellToolService';

/** Resolved shell base URL (loopback locally; Vite `/agent-shell` proxy on remote studios). */
export const SHELL_SERVER_URL = SHELL_SERVER;

export interface CapturedScreenshot {
  base64: string;
  mimeType: string;
  slideNumber: number;
  /** Optional label from shell (e.g. reel_frame_1, ig_slide_2) */
  label?: string;
}

export interface ScreenshotResult {
  screenshots: CapturedScreenshot[];
  count: number;
  url: string;
  kind?: 'static' | 'carousel' | 'video' | 'mixed' | string;
  partial?: boolean;
  warning?: string;
}

/**
 * Capture carousel slides or Reel frames from a URL using Playwright via the agent-shell-server.
 * @param url The post URL (e.g. https://instagram.com/p/... or /reel/...)
 * @param maxSlides Maximum of slides/frames to capture (default 10)
 */
export async function captureCarouselScreenshots(
  url: string,
  maxSlides = 10,
): Promise<ScreenshotResult> {
  const trimmed = (url || '').trim();
  if (!trimmed) {
    throw new Error('Paste an Instagram or reference post URL first.');
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    throw new Error('URL must start with https://');
  }

  const available = await isScreenshotServerAvailable();
  if (!available) {
    throw new Error(
      'Agent shell server is not running (port 3721). Start it with npm run agent:server (or npm run dev:agent), then retry.',
    );
  }

  const captureUrl = normalizeInstagramReferenceUrl(trimmed);
  const response = await fetch(`${SHELL_SERVER_URL}/screenshot-carousel`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: captureUrl, maxSlides }),
    // Instagram embeds + Chromium can still take a bit; fail clearly instead of hanging forever.
    signal: AbortSignal.timeout(90_000),
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(
      error.error ||
        `Screenshot capture failed (HTTP ${response.status}). Make sure the agent shell server is running on port 3721.`,
    );
  }

  const result = (await response.json()) as ScreenshotResult;
  if (!Array.isArray(result.screenshots) || result.screenshots.length === 0) {
    throw new Error(
      result.warning
      || 'No frames captured. The post may be private or blocked — upload screenshots manually instead.',
    );
  }
  return result;
}

/**
 * Check if the agent shell server is available.
 */
export async function isScreenshotServerAvailable(): Promise<boolean> {
  try {
    const response = await fetch(`${SHELL_SERVER_URL}/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return response.ok;
  } catch {
    return false;
  }
}
