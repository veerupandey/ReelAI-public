import { describe, expect, it } from 'vitest';
import type { ImageReferenceInput, SceneDraft, SceneReferenceBinding } from '../types';
import { buildRouteReferenceAssembly } from '../utils/sceneReferenceBuilder';

const createScene = (overrides: Partial<SceneDraft> = {}): SceneDraft => ({
  id: overrides.id || 'scene-1',
  sceneNumber: overrides.sceneNumber || 1,
  visualDescription: overrides.visualDescription || 'Hero serum in a surreal bathroom.',
  imagePrompt: overrides.imagePrompt || 'Hero serum in a surreal bathroom.',
  voiceoverText: overrides.voiceoverText || 'Glow without the harsh chemicals.',
  onScreenText: overrides.onScreenText || 'Glow without the harsh chemicals.',
  requestedDurationSec: overrides.requestedDurationSec || 3,
  resolvedDurationSec: overrides.resolvedDurationSec || 3,
  imageSource: overrides.imageSource || 'generated',
  captionMode: overrides.captionMode || 'derived',
  generationStatus: overrides.generationStatus || {
    script: 'clean',
    image: 'clean',
    voice: 'stale',
  },
  ...overrides,
});

const makeReference = (assetId: string, data: string): ImageReferenceInput => ({
  assetId,
  data,
  mimeType: 'image/png',
});

const makeBinding = (assetId: string, role: SceneReferenceBinding['role'], label: string): SceneReferenceBinding => ({
  assetId,
  source: assetId.startsWith('external_ref_') ? 'external_image' : 'brand_asset',
  role,
  label,
  base64: `base64-${assetId}`,
  mimeType: 'image/png',
});

describe('sceneReferenceBuilder', () => {
  it('builds upgrade requests with product provenance and supporting references', () => {
    const result = buildRouteReferenceAssembly({
      route: 'upgrade_existing',
      scene: createScene({
        sceneReferenceBindings: [makeBinding('external_ref_style', 'style_guide', 'Mood board')],
      }),
      currentReference: makeReference('current-asset', 'current'),
      previousReference: makeReference('previous-asset', 'prev'),
      productAnchor: makeBinding('asset-product', 'product', 'Hero bottle'),
    });

    expect(result.request?.mode).toBe('edit');
    expect(result.request?.primaryReference?.assetId).toBe('current-asset');
    expect(result.request?.references?.[0]?.role).toBe('style_guide');
    expect(result.sourceAssetIds).toEqual(['asset-product', 'external_ref_style']);
    expect(result.provenance.map((step) => step.role)).toEqual(['product', 'style_guide']);
  });

  it('caps user-selected references at four while preserving order for composite scenes', () => {
    const bindings = [
      makeBinding('asset-person', 'person', 'Model'),
      makeBinding('asset-env', 'environment', 'Bathroom set'),
      makeBinding('external_ref_style_a', 'style_guide', 'Mood A'),
      makeBinding('external_ref_style_b', 'style_guide', 'Mood B'),
      makeBinding('external_ref_style_c', 'reference', 'Mood C'),
    ];

    const result = buildRouteReferenceAssembly({
      route: 'composite_product',
      scene: createScene({ sceneReferenceBindings: bindings }),
      productAnchor: makeBinding('asset-product', 'product', 'Hero bottle'),
    });

    expect(result.selectedBindings).toHaveLength(4);
    expect(result.selectedBindings.map((binding) => binding.assetId)).toEqual([
      'asset-person',
      'asset-env',
      'external_ref_style_a',
      'external_ref_style_b',
    ]);
    expect(result.request?.mode).toBe('composite');
    expect(result.request?.references?.map((reference) => reference.role)).toEqual([
      'product',
      'person',
      'environment',
      'style_guide',
      'style_guide',
    ]);
    expect(result.provenance.map((step) => step.assetId)).toEqual([
      'asset-product',
      'asset-person',
      'asset-env',
      'external_ref_style_a',
      'external_ref_style_b',
    ]);
  });

  it('uses previous-scene continuity for continue-sequence and omits product auto-anchor in generate-fresh', () => {
    const selectedBindings = [makeBinding('external_ref_palette', 'style_guide', 'Palette')];
    const continueResult = buildRouteReferenceAssembly({
      route: 'continue_sequence',
      scene: createScene({ sceneReferenceBindings: selectedBindings }),
      previousReference: makeReference('previous-shot', 'prev'),
      productAnchor: makeBinding('asset-product', 'product', 'Hero bottle'),
    });

    expect(continueResult.request?.mode).toBe('edit');
    expect(continueResult.request?.primaryReference?.assetId).toBe('previous-shot');
    expect(continueResult.provenance.map((step) => step.role)).toEqual(['product', 'previous_scene', 'style_guide']);

    const freshResult = buildRouteReferenceAssembly({
      route: 'generate_fresh',
      scene: createScene({ sceneReferenceBindings: selectedBindings }),
      productAnchor: makeBinding('asset-product', 'product', 'Hero bottle'),
    });

    expect(freshResult.request?.mode).toBe('generate');
    expect(freshResult.request?.references?.map((reference) => reference.role)).toEqual(['style_guide']);
    expect(freshResult.sourceAssetIds).toEqual(['external_ref_palette']);
  });
});
