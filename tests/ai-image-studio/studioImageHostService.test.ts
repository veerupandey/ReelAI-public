import { describe, expect, it } from 'vitest';
import {
  isStudioImageHostingConfigured,
  hostStudioImagesForPublish,
} from '../../components/AIImageStudio/studioImageHostService';
import type { StudioAsset } from '../../components/AIImageStudio/types';

describe('studioImageHostService', () => {
  it('reports hosting as not configured', () => {
    expect(isStudioImageHostingConfigured()).toBe(false);
  });

  it('rejects publish hosting when cloud host is missing', async () => {
    const asset: StudioAsset = {
      id: 'a1',
      name: 'Hero',
      description: '',
      base64: btoa('x'),
      mimeType: 'image/png',
      width: 1,
      height: 1,
      source: 'generated',
      createdAt: new Date().toISOString(),
    };
    await expect(hostStudioImagesForPublish([asset])).rejects.toThrow(/hosting not configured/i);
  });
});
