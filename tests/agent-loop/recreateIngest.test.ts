import { describe, expect, it, vi } from 'vitest';
import {
  executeRecreateIngest,
  resolveReferenceUploadsForRecreate,
} from '../../services/agentLoop/recreateIngest';
import type { CreativeReferenceUpload } from '../../services/creativeReferenceDirector';

const uploads: CreativeReferenceUpload[] = [
  {
    id: 'u1',
    name: 'frame.jpg',
    base64: 'abc',
    mimeType: 'image/jpeg',
    note: 'hook',
  },
];

describe('resolveReferenceUploadsForRecreate', () => {
  it('prefers uploads over URL capture', () => {
    const d = resolveReferenceUploadsForRecreate({
      referenceUploads: uploads,
      referenceUrl: 'https://www.instagram.com/reel/abc/',
      ingest: 'url_screenshot_carousel',
    });
    expect(d.action).toBe('use_uploads');
  });

  it('captures URL when uploads empty and strategy is carousel', () => {
    const d = resolveReferenceUploadsForRecreate({
      referenceUploads: [],
      referenceUrl: 'https://www.instagram.com/reel/abc/',
      ingest: 'url_screenshot_carousel',
    });
    expect(d.action).toBe('capture_url');
    if (d.action === 'capture_url') expect(d.url).toContain('instagram.com');
  });

  it('needs HITL when neither uploads nor URL', () => {
    const d = resolveReferenceUploadsForRecreate({
      referenceUploads: [],
      ingest: 'none',
    });
    expect(d.action).toBe('none');
    if (d.action === 'none') expect(d.needsHitl).toBe(true);
  });
});

describe('executeRecreateIngest', () => {
  it('returns captured uploads from capture fn', async () => {
    const capture = vi.fn(async () => ({
      uploads,
      url: 'https://www.instagram.com/reel/abc/',
      warning: 'partial',
    }));
    const result = await executeRecreateIngest({
      referenceUploads: [],
      referenceUrl: 'https://www.instagram.com/reel/abc/',
      ingest: 'url_screenshot_carousel',
      capture: capture as any,
    });
    expect(capture).toHaveBeenCalled();
    expect(result.captured).toBe(true);
    expect(result.uploads).toHaveLength(1);
    expect(result.warning).toBe('partial');
  });

  it('flags needsHitl when capture throws', async () => {
    const capture = vi.fn(async () => {
      throw new Error('shell offline');
    });
    const result = await executeRecreateIngest({
      referenceUploads: [],
      referenceUrl: 'https://www.instagram.com/reel/abc/',
      ingest: 'url_screenshot_carousel',
      capture: capture as any,
    });
    expect(result.needsHitl).toBe(true);
    expect(result.error).toMatch(/shell offline/);
  });
});
