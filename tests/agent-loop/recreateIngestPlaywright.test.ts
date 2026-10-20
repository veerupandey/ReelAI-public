import { describe, expect, it, vi } from 'vitest';
import {
  executeRecreateIngest,
  shouldUsePlaywrightMcpCapture,
} from '../../services/agentLoop/recreateIngest';
import type { CreativeReferenceUpload } from '../../services/creativeReferenceDirector';

const frame: CreativeReferenceUpload = {
  id: 'pw1',
  name: 'ref.png',
  base64: 'abc',
  mimeType: 'image/png',
  note: 'playwright',
};

describe('shouldUsePlaywrightMcpCapture', () => {
  it('uses Playwright for non-social playwright_mcp when capture exists', () => {
    expect(shouldUsePlaywrightMcpCapture({
      strategy: 'playwright_mcp',
      url: 'https://example.com/product/1',
      hasPlaywrightCapture: true,
    })).toBe(true);
  });

  it('keeps social URLs on screenshot-carousel', () => {
    expect(shouldUsePlaywrightMcpCapture({
      strategy: 'playwright_mcp',
      url: 'https://www.instagram.com/reel/abc/',
      hasPlaywrightCapture: true,
    })).toBe(false);
  });

  it('skips when no playwright capture fn', () => {
    expect(shouldUsePlaywrightMcpCapture({
      strategy: 'playwright_mcp',
      url: 'https://example.com/p',
      hasPlaywrightCapture: false,
    })).toBe(false);
  });
});

describe('executeRecreateIngest playwright path', () => {
  it('prefers Playwright MCP when strategy is playwright_mcp and tools exist', async () => {
    const playwrightCapture = vi.fn(async () => ({
      uploads: [frame],
      log: ['navigated'],
    }));
    const capture = vi.fn(async () => ({
      uploads: [],
      url: 'https://example.com/p',
    }));
    const result = await executeRecreateIngest({
      referenceUploads: [],
      referenceUrl: 'https://example.com/product/1',
      ingest: 'playwright_mcp',
      capture: capture as any,
      playwrightCapture,
    });
    expect(playwrightCapture).toHaveBeenCalled();
    expect(capture).not.toHaveBeenCalled();
    expect(result.usedPlaywright).toBe(true);
    expect(result.uploads).toHaveLength(1);
  });

  it('falls back to carousel when Playwright throws', async () => {
    const playwrightCapture = vi.fn(async () => {
      throw new Error('MCP down');
    });
    const capture = vi.fn(async () => ({
      uploads: [frame],
      url: 'https://example.com/p',
    }));
    const result = await executeRecreateIngest({
      referenceUploads: [],
      referenceUrl: 'https://example.com/product/1',
      ingest: 'playwright_mcp',
      capture: capture as any,
      playwrightCapture,
    });
    expect(capture).toHaveBeenCalled();
    expect(result.usedPlaywright).toBe(false);
    expect(result.uploads).toHaveLength(1);
    expect(result.log.some((l) => /falling back/i.test(l))).toBe(true);
  });
});
