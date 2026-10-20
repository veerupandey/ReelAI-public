import { describe, expect, it } from 'vitest';
import type { SceneDraft, UploadedMedia } from '../types';
import {
  buildRouteAwareImageRequest,
  createSceneDraftsFromMediaAndScript,
  deriveMediaFromSceneDrafts,
  getEffectiveStoryboardRoute,
  promoteSceneImageVariant,
  reconcileSceneDraftsWithMedia,
  syncStoryboardMetadataAcrossDraftsAndMedia,
} from '../utils/sceneDrafts';

const createMedia = (overrides: Partial<UploadedMedia> = {}): UploadedMedia => ({
  id: overrides.id || 'media-1',
  sceneId: overrides.sceneId || overrides.id || 'scene-1',
  file: new File([], overrides.name || 'scene.png', { type: overrides.mimeType || 'image/png' }),
  previewUrl: overrides.previewUrl || 'data:image/png;base64,ZmFrZQ==',
  thumbnailUrl: overrides.thumbnailUrl || overrides.previewUrl || 'data:image/png;base64,ZmFrZQ==',
  type: overrides.type || 'image',
  mimeType: overrides.mimeType || 'image/png',
  duration: overrides.duration || 3,
  description: overrides.description || 'Hero product frame',
  imagePrompt: overrides.imagePrompt || 'Hero product frame',
  ...overrides,
});

const createDraft = (overrides: Partial<SceneDraft> = {}): SceneDraft => ({
  id: overrides.id || 'scene-1',
  sceneNumber: overrides.sceneNumber || 1,
  visualDescription: overrides.visualDescription || 'Hero product frame',
  imagePrompt: overrides.imagePrompt || 'Hero product frame',
  voiceoverText: overrides.voiceoverText || 'Glow in one drop.',
  onScreenText: overrides.onScreenText || 'Glow in one drop.',
  requestedDurationSec: overrides.requestedDurationSec || 3,
  resolvedDurationSec: overrides.resolvedDurationSec || 3,
  imageSource: overrides.imageSource || 'brand_asset',
  captionMode: overrides.captionMode || 'derived',
  generationStatus: overrides.generationStatus || {
    script: 'clean',
    image: 'clean',
    voice: 'stale',
  },
  ...overrides,
});

describe('sceneDraft storyboard continuity', () => {
  it('preserves approved storyboard metadata when creating drafts from media', () => {
    const media = createMedia({
      productId: 'product-1',
      productTitle: 'Saffron Oil',
      storyboardRoute: 'use_existing',
      storyboardSourceMode: 'use_exact_asset',
      storyboardBaseAssetId: 'asset-hero',
      storyboardBaseAssetDescription: 'Hero packshot on warm stone',
      storyboardDirectorsNote: 'Keep label perfectly readable.',
    });

    const drafts = createSceneDraftsFromMediaAndScript([media], null);

    expect(drafts[0].productTitle).toBe('Saffron Oil');
    expect(drafts[0].storyboardRoute).toBe('use_existing');
    expect(drafts[0].storyboardSourceMode).toBe('use_exact_asset');
    expect(drafts[0].storyboardBaseAssetDescription).toBe('Hero packshot on warm stone');
    expect(drafts[0].storyboardDirectorsNote).toBe('Keep label perfectly readable.');
  });

  it('preserves approved storyboard metadata when deriving media from drafts', () => {
    const draft = createDraft({
      productId: 'product-2',
      productTitle: 'Glow Serum',
      storyboardRoute: 'upgrade_existing',
      storyboardRouteOverride: 'composite_product',
      sceneReferenceBindings: [{
        assetId: 'external_ref_style',
        source: 'external_image',
        role: 'style_guide',
        label: 'Mood board',
        base64: 'cmVm',
        mimeType: 'image/png',
      }],
      storyboardSourceMode: 'edit_from_asset',
      storyboardLinkedAssetId: 'variant-1',
      storyboardLinkedAssetDescription: 'Smiling model with product',
      storyboardRouteReason: 'Upgrade the existing shot without losing the exact bottle.',
    });

    const media = deriveMediaFromSceneDrafts([draft]);

    expect(media[0].productTitle).toBe('Glow Serum');
    expect(media[0].storyboardRoute).toBe('upgrade_existing');
    expect(media[0].storyboardRouteOverride).toBe('composite_product');
    expect(media[0].sceneReferenceBindings?.[0]?.assetId).toBe('external_ref_style');
    expect(media[0].storyboardSourceMode).toBe('edit_from_asset');
    expect(media[0].storyboardLinkedAssetId).toBe('variant-1');
    expect(media[0].storyboardRouteReason).toContain('Upgrade the existing shot');
  });

  it('backfills continuity metadata between drafts and media from whichever side still has it', () => {
    const draft = createDraft({
      id: 'scene-backfill',
      media: undefined,
    });
    const media = createMedia({
      id: 'scene-backfill',
      sceneId: 'scene-backfill',
      productTitle: 'Vitamin C Cleanser',
      storyboardRoute: 'composite_product',
      storyboardBaseAssetId: 'asset-cleanser',
    });

    const syncedFromMedia = syncStoryboardMetadataAcrossDraftsAndMedia([draft], [media]);
    expect(syncedFromMedia.drafts[0].productTitle).toBe('Vitamin C Cleanser');
    expect(syncedFromMedia.drafts[0].storyboardRoute).toBe('composite_product');

    const draftWithMetadata = createDraft({
      id: 'scene-backfill-2',
      productTitle: 'Night Repair Oil',
      storyboardRoute: 'generate_fresh',
      storyboardRouteOverride: 'continue_sequence',
      storyboardDirectorsNote: 'Use surreal golden liquid lighting.',
    });
    const mediaWithoutMetadata = createMedia({
      id: 'scene-backfill-2',
      sceneId: 'scene-backfill-2',
      productTitle: undefined,
      storyboardRoute: undefined,
      storyboardDirectorsNote: undefined,
    });

    const syncedFromDraft = syncStoryboardMetadataAcrossDraftsAndMedia([draftWithMetadata], [mediaWithoutMetadata]);
    expect(syncedFromDraft.media[0].productTitle).toBe('Night Repair Oil');
    expect(syncedFromDraft.media[0].storyboardRoute).toBe('generate_fresh');
    expect(syncedFromDraft.media[0].storyboardRouteOverride).toBe('continue_sequence');
    expect(syncedFromDraft.media[0].storyboardDirectorsNote).toBe('Use surreal golden liquid lighting.');
  });

  it('keeps metadata attached to the same scene when media is reordered', () => {
    const previousDrafts = [
      createDraft({
        id: 'scene-a',
        sceneNumber: 1,
        productTitle: 'Product A',
        storyboardRoute: 'use_existing',
        media: createMedia({ id: 'scene-a', sceneId: 'scene-a', previewUrl: 'data:image/png;base64,QQ==' }),
      }),
      createDraft({
        id: 'scene-b',
        sceneNumber: 2,
        productTitle: 'Product B',
        storyboardRoute: 'generate_fresh',
        media: createMedia({ id: 'scene-b', sceneId: 'scene-b', previewUrl: 'data:image/png;base64,Qg==' }),
      }),
    ];

    const reorderedMedia = [
      createMedia({ id: 'scene-b', sceneId: 'scene-b', previewUrl: 'data:image/png;base64,Qg==', productTitle: undefined, storyboardRoute: undefined }),
      createMedia({ id: 'scene-a', sceneId: 'scene-a', previewUrl: 'data:image/png;base64,QQ==', productTitle: undefined, storyboardRoute: undefined }),
    ];

    const reconciled = reconcileSceneDraftsWithMedia(previousDrafts, reorderedMedia);

    expect(reconciled[0].id).toBe('scene-b');
    expect(reconciled[0].productTitle).toBe('Product B');
    expect(reconciled[0].storyboardRoute).toBe('generate_fresh');
    expect(reconciled[1].id).toBe('scene-a');
    expect(reconciled[1].productTitle).toBe('Product A');
    expect(reconciled[1].storyboardRoute).toBe('use_existing');
  });

  it('prefers route override, then approved route, then source mode fallback', () => {
    expect(getEffectiveStoryboardRoute({
      storyboardRoute: 'upgrade_existing',
      storyboardRouteOverride: 'composite_product',
    })).toBe('composite_product');

    expect(getEffectiveStoryboardRoute({
      storyboardRoute: 'use_existing',
    })).toBe('use_existing');

    expect(getEffectiveStoryboardRoute({
      storyboardSourceMode: 'generate_matching_shot',
    })).toBe('composite_product');
  });

  it('builds route-aware requests for upgrade and continue-sequence fallback', () => {
    const previous = createDraft({
      id: 'scene-prev',
      sceneNumber: 1,
      media: createMedia({
        id: 'scene-prev',
        sceneId: 'scene-prev',
        base64: 'ZmFrZQ==',
        previewUrl: 'data:image/png;base64,ZmFrZQ==',
      }),
    });
    const current = createDraft({
      id: 'scene-current',
      sceneNumber: 2,
      storyboardRoute: 'upgrade_existing',
      media: createMedia({
        id: 'scene-current',
        sceneId: 'scene-current',
        base64: 'ZmFrZTI=',
        previewUrl: 'data:image/png;base64,ZmFrZTI=',
      }),
    });

    const upgradeRequest = buildRouteAwareImageRequest(
      [previous, current],
      deriveMediaFromSceneDrafts([previous, current]),
      1,
      'upgrade_existing',
    );
    expect(upgradeRequest?.mode).toBe('edit');
    expect(upgradeRequest?.primaryReference?.data).toBe('ZmFrZTI=');
    expect(upgradeRequest?.prevSceneReference?.data).toBe('ZmFrZQ==');

    const firstSceneFallback = buildRouteAwareImageRequest(
      [current],
      deriveMediaFromSceneDrafts([current]),
      0,
      'continue_sequence',
    );
    expect(firstSceneFallback?.mode).toBe('generate');
  });

  it('restores scene reference bindings and provenance when promoting a variant', () => {
    const draft = createDraft({
      id: 'scene-variant',
      media: createMedia({
        id: 'scene-variant',
        sceneId: 'scene-variant',
      }),
      imageVariants: [
        {
          id: 'variant-a',
          label: 'Current',
          imageSource: 'generated',
          createdAt: new Date().toISOString(),
          media: createMedia({
            id: 'scene-variant',
            sceneId: 'scene-variant',
          }),
        },
        {
          id: 'variant-b',
          label: 'Composite',
          imageSource: 'generated',
          createdAt: new Date().toISOString(),
          media: createMedia({
            id: 'scene-variant-b',
            sceneId: 'scene-variant',
            sceneReferenceBindings: [{
              assetId: 'external_ref_person',
              source: 'external_image',
              role: 'person',
              label: 'Model ref',
              base64: 'bW9kZWw=',
              mimeType: 'image/png',
            }],
            sourceAssetIds: ['asset-product', 'external_ref_person'],
            provenance: [
              { assetId: 'asset-product', role: 'product', preserve: ['product_identity'] },
              { assetId: 'external_ref_person', role: 'person', preserve: ['person_identity'] },
            ],
          }),
          sourceAssetIds: ['asset-product', 'external_ref_person'],
          provenance: [
            { assetId: 'asset-product', role: 'product', preserve: ['product_identity'] },
            { assetId: 'external_ref_person', role: 'person', preserve: ['person_identity'] },
          ],
        },
      ],
      activeVariantId: 'variant-a',
    });

    const promoted = promoteSceneImageVariant(draft, 'variant-b');

    expect(promoted.sceneReferenceBindings?.[0]?.assetId).toBe('external_ref_person');
    expect(promoted.sourceAssetIds).toEqual(['asset-product', 'external_ref_person']);
    expect(promoted.provenance?.map((step) => step.role)).toEqual(['product', 'person']);
  });
});
