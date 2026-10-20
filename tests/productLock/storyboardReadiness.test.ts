import { describe, expect, it } from 'vitest';
import type { StoryboardSceneState } from '../../types/brand';
import {
  buildAgencyStoryboardWarnings,
  getAdFormatForPlatform,
  getAgencyStoryboardNextState,
  getPreferredPlatformForAdFormat,
  getSceneDisplayAssetId,
  sceneHasVisualReady,
  sceneNeedsBoundAsset,
} from '../../components/productLock/productLockViewUtils';

const scene = (overrides: Partial<StoryboardSceneState> = {}): StoryboardSceneState => ({
  id: overrides.id || 'scene_1',
  text: overrides.text ?? 'Hook: dull skin, meet saffron glow',
  visualDescription: overrides.visualDescription ?? 'Hero packshot opening',
  imagePrompt: overrides.imagePrompt ?? 'Premium bottle hero',
  ...overrides,
});

describe('agency storyboard readiness helpers', () => {
  it('prefers generated/selected assets for display', () => {
    expect(getSceneDisplayAssetId({
      baseAssetId: 'base',
      linkedAssetId: 'linked',
      selectedVariantAssetId: 'variant',
    })).toBe('variant');
    expect(getSceneDisplayAssetId({
      baseAssetId: 'base',
      linkedAssetId: 'linked',
    })).toBe('linked');
    expect(getSceneDisplayAssetId({ baseAssetId: 'base' })).toBe('base');
  });

  it('treats generate_fresh scenes as visually ready without a bound asset', () => {
    const fresh = scene({ route: 'generate_fresh', visualTask: 'generate_new' });
    expect(sceneNeedsBoundAsset(fresh)).toBe(false);
    expect(sceneHasVisualReady(fresh)).toBe(true);
  });

  it('flags use_existing scenes without assets as needing a bind', () => {
    const unbound = scene({ route: 'use_existing', visualTask: 'use_imported' });
    expect(sceneNeedsBoundAsset(unbound)).toBe(true);
    expect(sceneHasVisualReady(unbound)).toBe(false);
  });

  it('blocks next without brief or scenes, without requiring approval', () => {
    const empty = getAgencyStoryboardNextState('', [], 'stitched_video');
    expect(empty.canProceed).toBe(false);
    expect(empty.blockers.length).toBeGreaterThan(0);

    const ready = getAgencyStoryboardNextState(
      'Make a premium skincare ad',
      [
        scene({ text: 'Hook opening beat' }),
        scene({ id: 'scene_2', text: 'Proof demo texture', visualDescription: 'Application demo proof' }),
        scene({ id: 'scene_3', text: 'Shop now CTA closing hero', visualDescription: 'Final packshot CTA' }),
      ],
      'stitched_video',
    );
    expect(ready.canProceed).toBe(true);
    expect(ready.warnings.some((warning) => warning.type === 'approval')).toBe(false);
  });

  it('warns when carousel slides are still pending generation', () => {
    const warnings = buildAgencyStoryboardWarnings(
      [scene({ route: 'generate_fresh', linkedAssetId: undefined })],
      'carousel',
    );
    expect(warnings.some((warning) => /carousel slide/i.test(warning.message))).toBe(true);
  });

  it('syncs platform and ad format preferences', () => {
    expect(getAdFormatForPlatform('instagram_carousel')).toBe('carousel');
    expect(getAdFormatForPlatform('instagram_feed')).toBe('static_image');
    expect(getPreferredPlatformForAdFormat('carousel', 'tiktok')).toBe('instagram_carousel');
    expect(getPreferredPlatformForAdFormat('stitched_video', 'instagram_carousel')).toBe('instagram_reels');
  });
});
