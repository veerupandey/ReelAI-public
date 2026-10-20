/**
 * Resolve how to obtain reference frames for recreate-reference flows.
 */
import type { CreativeReferenceUpload } from '../creativeReferenceDirector';
import {
  captureReferencePostUrl,
  isLikelyReferencePostUrl,
} from '../referencePostCapture';
import type { ReferenceIngestStrategy } from './recreateReferencePath';

export type RecreateIngestAction =
  | { action: 'use_uploads'; uploads: CreativeReferenceUpload[]; reason: string }
  | { action: 'capture_url'; url: string; strategy: ReferenceIngestStrategy; reason: string }
  | { action: 'none'; reason: string; needsHitl: boolean };

export type PlaywrightCaptureFn = (url: string) => Promise<{
  uploads: CreativeReferenceUpload[];
  log?: string[];
}>;

/**
 * Pure decision: uploads win; else capture from URL when strategy requires it.
 */
export function resolveReferenceUploadsForRecreate(args: {
  referenceUploads: CreativeReferenceUpload[];
  referenceUrl?: string;
  ingest: ReferenceIngestStrategy;
}): RecreateIngestAction {
  const uploads = args.referenceUploads || [];
  if (uploads.length > 0) {
    return {
      action: 'use_uploads',
      uploads,
      reason: `Using ${uploads.length} uploaded reference frame(s)`,
    };
  }

  const url = (args.referenceUrl || '').trim();
  if (
    url
    && (args.ingest === 'url_screenshot_carousel' || args.ingest === 'playwright_mcp')
  ) {
    return {
      action: 'capture_url',
      url,
      strategy: args.ingest,
      reason: args.ingest === 'url_screenshot_carousel'
        ? 'No uploads — capture social URL via screenshot-carousel'
        : 'No uploads — capture reference URL via Playwright MCP',
    };
  }

  return {
    action: 'none',
    reason: 'No reference uploads or capture URL available',
    needsHitl: true,
  };
}

/**
 * Prefer Playwright MCP for `playwright_mcp` when a capture fn is provided;
 * social URLs still use screenshot-carousel.
 */
export function shouldUsePlaywrightMcpCapture(args: {
  strategy: ReferenceIngestStrategy;
  url: string;
  hasPlaywrightCapture: boolean;
}): boolean {
  if (args.strategy !== 'playwright_mcp') return false;
  if (!args.hasPlaywrightCapture) return false;
  // IG/TikTok stay on screenshot-carousel even if strategy says playwright_mcp.
  if (isLikelyReferencePostUrl(args.url)) return false;
  return true;
}

/**
 * Execute ingest: return effective uploads (existing or newly captured).
 */
export async function executeRecreateIngest(args: {
  referenceUploads: CreativeReferenceUpload[];
  referenceUrl?: string;
  ingest: ReferenceIngestStrategy;
  capture?: typeof captureReferencePostUrl;
  playwrightCapture?: PlaywrightCaptureFn;
}): Promise<{
  uploads: CreativeReferenceUpload[];
  captured: boolean;
  warning?: string;
  error?: string;
  needsHitl: boolean;
  log: string[];
  usedPlaywright?: boolean;
}> {
  const decision = resolveReferenceUploadsForRecreate(args);
  const log: string[] = [decision.reason];

  if (decision.action === 'use_uploads') {
    return {
      uploads: decision.uploads,
      captured: false,
      needsHitl: false,
      log,
    };
  }

  if (decision.action === 'none') {
    return {
      uploads: [],
      captured: false,
      needsHitl: decision.needsHitl,
      error: decision.reason,
      log,
    };
  }

  const usePlaywright = shouldUsePlaywrightMcpCapture({
    strategy: decision.strategy,
    url: decision.url,
    hasPlaywrightCapture: typeof args.playwrightCapture === 'function',
  });

  if (usePlaywright && args.playwrightCapture) {
    try {
      log.push('Using Playwright MCP navigate + screenshot');
      const result = await args.playwrightCapture(decision.url);
      if (result.log?.length) log.push(...result.log);
      log.push(`Captured ${result.uploads.length} frame(s) via Playwright MCP`);
      return {
        uploads: result.uploads,
        captured: true,
        needsHitl: result.uploads.length === 0,
        log,
        usedPlaywright: true,
        error: result.uploads.length === 0 ? 'Playwright capture returned no frames' : undefined,
      };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      log.push(`Playwright MCP failed: ${msg} — falling back to screenshot-carousel`);
      // fall through to carousel capture
    }
  } else if (decision.strategy === 'playwright_mcp' && !isLikelyReferencePostUrl(decision.url)) {
    log.push('Playwright MCP unavailable — attempting screenshot-carousel fallback');
  }

  const captureFn = args.capture || captureReferencePostUrl;
  try {
    if (
      decision.strategy === 'playwright_mcp'
      && !isLikelyReferencePostUrl(decision.url)
    ) {
      log.push('Non-social URL — attempting screenshot-carousel / Playwright capture');
    }
    const result = await captureFn(decision.url, { maxSlides: 10, existingCount: 0 });
    if (result.warning) log.push(result.warning);
    log.push(`Captured ${result.uploads.length} frame(s) from ${result.url}`);
    return {
      uploads: result.uploads,
      captured: true,
      warning: result.warning,
      needsHitl: result.uploads.length === 0,
      log,
      usedPlaywright: false,
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    log.push(`Capture failed: ${msg}`);
    return {
      uploads: [],
      captured: false,
      error: msg,
      needsHitl: true,
      log,
    };
  }
}
