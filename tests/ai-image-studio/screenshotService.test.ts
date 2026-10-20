import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  SHELL_SERVER_URL,
  captureCarouselScreenshots,
  isScreenshotServerAvailable,
} from '../../components/AIImageStudio/screenshotService';

describe('screenshotService', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('uses IPv4 loopback for the shell on localhost (not localhost/::1)', () => {
    expect(SHELL_SERVER_URL).toBe('http://127.0.0.1:3721');
  });

  it('reports shell availability from /health', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('fetch', fetchMock);
    await expect(isScreenshotServerAvailable()).resolves.toBe(true);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:3721/health',
      expect.objectContaining({ signal: expect.any(AbortSignal) }),
    );
  });

  it('fails fast when the shell is down', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    await expect(
      captureCarouselScreenshots('https://www.instagram.com/p/CjG1w7DMiQM/'),
    ).rejects.toThrow(/shell server is not running/i);
  });

  it('normalizes /reels/ URLs and requires at least one screenshot', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return { ok: true };
      if (url.endsWith('/screenshot-carousel')) {
        return {
          ok: true,
          json: async () => ({
            screenshots: [],
            count: 0,
            url: 'https://www.instagram.com/reel/Da8OPi6saHl/',
            warning: 'empty',
          }),
        };
      }
      throw new Error(`unexpected fetch ${url}`);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      captureCarouselScreenshots('https://www.instagram.com/reels/Da8OPi6saHl/'),
    ).rejects.toThrow(/empty|No frames captured/i);

    const postCall = fetchMock.mock.calls.find(([u]) => String(u).endsWith('/screenshot-carousel'));
    expect(postCall).toBeTruthy();
    const body = JSON.parse(String(postCall?.[1]?.body || '{}'));
    expect(body.url).toBe('https://www.instagram.com/reel/Da8OPi6saHl/');
  });

  it('returns screenshots from a successful shell capture', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/health')) return { ok: true };
      return {
        ok: true,
        json: async () => ({
          screenshots: [
            { base64: 'aaa', mimeType: 'image/jpeg', slideNumber: 1 },
            { base64: 'bbb', mimeType: 'image/jpeg', slideNumber: 2 },
          ],
          count: 2,
          url: 'https://www.instagram.com/p/abc/',
          kind: 'carousel',
          source: 'instagram_graphql',
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await captureCarouselScreenshots('https://www.instagram.com/p/abc/', 10);
    expect(result.screenshots).toHaveLength(2);
    expect(result.kind).toBe('carousel');
  });
});
