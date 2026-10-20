import { describe, it, expect } from 'vitest';
import { studioReducer, initialState, StudioAction } from '../../components/AIImageStudio/useStudioReducer';
import type { StudioAsset, HistoryEntry, StudioState } from '../../components/AIImageStudio/types';

function makeAsset(overrides: Partial<StudioAsset> = {}): StudioAsset {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    name: 'Test Asset',
    description: 'A test asset',
    base64: 'data:image/png;base64,abc',
    mimeType: 'image/png',
    width: 1080,
    height: 1920,
    source: 'upload',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeHistoryEntry(overrides: Partial<HistoryEntry> = {}): HistoryEntry {
  return {
    id: overrides.id ?? crypto.randomUUID(),
    prompt: 'test prompt',
    creativeRoute: 'generate_fresh',
    aspectRatio: '9:16',
    referenceAssetIds: [],
    status: 'success',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

describe('studioReducer', () => {
  describe('ADD_ASSETS', () => {
    it('appends assets to the array', () => {
      const asset1 = makeAsset({ id: 'a1' });
      const asset2 = makeAsset({ id: 'a2' });
      const state = studioReducer(initialState, { type: 'ADD_ASSETS', assets: [asset1, asset2] });
      expect(state.assets).toHaveLength(2);
      expect(state.assets[0].id).toBe('a1');
      expect(state.assets[1].id).toBe('a2');
    });
  });

  describe('REMOVE_ASSET', () => {
    it('removes asset from assets, gallery selection, composer refs, and roleAssignments', () => {
      const asset = makeAsset({ id: 'a1' });
      let state: StudioState = {
        ...initialState,
        assets: [asset],
        gallerySelectionIds: new Set(['a1']),
        composerReferences: [{ assetId: 'a1', role: 'product' }],
        roleAssignments: new Map([['a1', { role: 'product' }]]),
        detailAssetId: 'a1',
      };
      state = studioReducer(state, { type: 'REMOVE_ASSET', id: 'a1' });
      expect(state.assets).toHaveLength(0);
      expect(state.gallerySelectionIds.size).toBe(0);
      expect(state.composerReferences).toHaveLength(0);
      expect(state.roleAssignments.size).toBe(0);
      expect(state.detailAssetId).toBeNull();
    });

    it('does not clear detailAssetId if different asset removed', () => {
      const state: StudioState = {
        ...initialState,
        assets: [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2' })],
        detailAssetId: 'a2',
      };
      const next = studioReducer(state, { type: 'REMOVE_ASSET', id: 'a1' });
      expect(next.detailAssetId).toBe('a2');
    });
  });

  describe('UPDATE_ASSET', () => {
    it('updates the specified asset', () => {
      const state: StudioState = {
        ...initialState,
        assets: [makeAsset({ id: 'a1', name: 'Old Name' })],
      };
      const next = studioReducer(state, { type: 'UPDATE_ASSET', id: 'a1', updates: { name: 'New Name' } });
      expect(next.assets[0].name).toBe('New Name');
    });
  });

  describe('variation favorites', () => {
    it('toggles a favorite only for variation assets', () => {
      const state: StudioState = {
        ...initialState,
        assets: [
          makeAsset({ id: 'v1', variationSetId: 'set-1', variationIndex: 1 }),
          makeAsset({ id: 'plain' }),
        ],
      };

      const favorited = studioReducer(state, {
        type: 'TOGGLE_VARIATION_FAVORITE',
        assetId: 'v1',
      });
      expect(favorited.assets[0].isFavorite).toBe(true);

      const restored = studioReducer(favorited, {
        type: 'TOGGLE_VARIATION_FAVORITE',
        assetId: 'v1',
      });
      expect(restored.assets[0].isFavorite).toBe(false);

      const plain = studioReducer(state, {
        type: 'TOGGLE_VARIATION_FAVORITE',
        assetId: 'plain',
      });
      expect(plain.assets[1].isFavorite).toBeUndefined();
    });

    it('keeps favorites and cleans references to removed variations', () => {
      const state: StudioState = {
        ...initialState,
        assets: [
          makeAsset({
            id: 'v1',
            variationSetId: 'set-1',
            variationIndex: 1,
            isFavorite: true,
          }),
          makeAsset({ id: 'v2', variationSetId: 'set-1', variationIndex: 2 }),
          makeAsset({ id: 'other', variationSetId: 'set-2', variationIndex: 1 }),
        ],
        gallerySelectionIds: new Set(['v1', 'v2']),
        composerReferences: [{ assetId: 'v2', role: 'product' }],
        roleAssignments: new Map([['v2', { role: 'product' }]]),
        detailAssetId: 'v2',
      };

      const next = studioReducer(state, {
        type: 'KEEP_VARIATION_FAVORITES',
        variationSetId: 'set-1',
      });

      expect(next.assets.map((asset) => asset.id)).toEqual(['v1', 'other']);
      expect(next.gallerySelectionIds.has('v2')).toBe(false);
      expect(next.composerReferences).toHaveLength(0);
      expect(next.roleAssignments.has('v2')).toBe(false);
      expect(next.detailAssetId).toBeNull();
    });

    it('does nothing when a set has no favorites', () => {
      const state: StudioState = {
        ...initialState,
        assets: [makeAsset({ id: 'v1', variationSetId: 'set-1', variationIndex: 1 })],
      };
      const next = studioReducer(state, {
        type: 'KEEP_VARIATION_FAVORITES',
        variationSetId: 'set-1',
      });
      expect(next).toBe(state);
    });

    it('does not apply variation actions to carousel metadata', () => {
      const carousel = makeAsset({
        id: 'slide-1',
        carouselSetId: 'carousel-1',
        carouselSlideIndex: 1,
        // Defensive compatibility case: mixed persisted metadata must remain non-destructive.
        variationSetId: 'set-1',
        variationIndex: 1,
        isFavorite: true,
      });
      const state: StudioState = {
        ...initialState,
        assets: [carousel],
        postQueueIds: ['slide-1'],
      };

      const toggled = studioReducer(state, {
        type: 'TOGGLE_VARIATION_FAVORITE',
        assetId: 'slide-1',
      });
      expect(toggled.assets[0].isFavorite).toBe(true);

      const kept = studioReducer(state, {
        type: 'KEEP_VARIATION_FAVORITES',
        variationSetId: 'set-1',
      });
      expect(kept).toBe(state);
      expect(kept.postQueueIds).toEqual(['slide-1']);
    });
  });

  describe('TOGGLE_SELECT', () => {
    it('adds asset to gallerySelectionIds', () => {
      const state: StudioState = { ...initialState, assets: [makeAsset({ id: 'a1' })] };
      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'a1' });
      expect(next.gallerySelectionIds.has('a1')).toBe(true);
    });

    it('removes asset from selection if already present', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1']),
      };
      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'a1' });
      expect(next.gallerySelectionIds.has('a1')).toBe(false);
    });

    it('rejects selection when already at max (100)', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(ids),
      };
      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'new-asset' });
      expect(next.gallerySelectionIds.size).toBe(100);
      expect(next.gallerySelectionIds.has('new-asset')).toBe(false);
      expect(next).toBe(state);
    });

    it('allows deselection even when at max', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(ids),
      };
      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'a0' });
      expect(next.gallerySelectionIds.size).toBe(99);
      expect(next.gallerySelectionIds.has('a0')).toBe(false);
    });
  });

  describe('CLEAR_SELECTION', () => {
    it('empties gallerySelectionIds', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2', 'a3']),
      };
      const next = studioReducer(state, { type: 'CLEAR_SELECTION' });
      expect(next.gallerySelectionIds.size).toBe(0);
    });
  });

  describe('product truth stale sync on selection', () => {
    const productTruth = {
      id: 'pt-1',
      productName: 'Matcha',
      protectedAssetIds: ['a1', 'a2'],
      preservationRules: ['Keep label'],
      verifiedFacts: [],
      unresolvedQuestions: [],
      userCorrections: [],
    };

    it('marks product truth and concepts stale when TOGGLE_SELECT diverges from protectedAssetIds', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2']),
        productTruth,
        brandKnowledge: { id: 'bk' } as StudioState['brandKnowledge'],
        trendResearch: { id: 'tr', insights: [] } as StudioState['trendResearch'],
        strategistBrief: {
          id: 'sb',
          campaignGoal: 'Goal',
          executionMode: 'hybrid',
          summary: 'Summary',
          brandFit: '',
          productFit: '',
          trendAngles: [],
          preservationPriorities: [],
          creativeTerritories: [],
          constraints: [],
          openQuestions: [],
          sourceInsightIds: [],
          createdAt: '',
        },
        conceptCandidates: [
          {
            id: 'c1',
            title: 'Concept',
            oneLineIdea: 'Idea',
            visualDirection: 'Dir',
            brandFitRationale: 'Fit',
            productTruthNotes: [],
            suggestedReferenceRoles: [],
            sourceTrendInsightIds: [],
            status: 'candidate',
          },
        ],
      };

      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'a3' });
      expect(next.productTruthStale).toBe(true);
      expect(next.strategistBriefStale).toBe(true);
      expect(next.conceptCandidates[0].status).toBe('stale');
      // Research preserved
      expect(next.brandKnowledge).toBe(state.brandKnowledge);
      expect(next.trendResearch).toBe(state.trendResearch);
      expect(next.productTruth).toBe(state.productTruth);
      expect(next.strategistBrief).toBe(state.strategistBrief);
    });

    it('clears stale flags when selection returns to protectedAssetIds', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2', 'a3']),
        productTruth,
        productTruthStale: true,
        strategistBriefStale: true,
      };
      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'a3' });
      expect(next.gallerySelectionIds).toEqual(new Set(['a1', 'a2']));
      expect(next.productTruthStale).toBe(false);
      expect(next.strategistBriefStale).toBe(false);
    });

    it('marks stale on CLEAR_SELECTION when product truth has protected assets', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2']),
        productTruth,
      };
      const next = studioReducer(state, { type: 'CLEAR_SELECTION' });
      expect(next.productTruthStale).toBe(true);
      expect(next.productTruth).toBe(state.productTruth);
    });

    it('marks stale on GALLERY_TOGGLE_SELECT divergence without wiping research', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2']),
        productTruth,
        brandKnowledge: { id: 'bk' } as StudioState['brandKnowledge'],
        conceptCandidates: [
          {
            id: 'c1',
            title: 'Concept',
            oneLineIdea: 'Idea',
            visualDirection: 'Dir',
            brandFitRationale: 'Fit',
            productTruthNotes: [],
            suggestedReferenceRoles: [],
            sourceTrendInsightIds: [],
            status: 'candidate',
          },
        ],
      };
      const next = studioReducer(state, { type: 'GALLERY_TOGGLE_SELECT', id: 'a1' });
      expect(next.productTruthStale).toBe(true);
      expect(next.conceptCandidates[0].status).toBe('stale');
      expect(next.brandKnowledge).toBe(state.brandKnowledge);
    });

    it('clears stale on GALLERY_CLEAR_SELECTION when protectedAssetIds is empty', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1']),
        productTruth: { ...productTruth, protectedAssetIds: [] },
        productTruthStale: true,
        strategistBriefStale: true,
      };
      const next = studioReducer(state, { type: 'GALLERY_CLEAR_SELECTION' });
      expect(next.gallerySelectionIds.size).toBe(0);
      expect(next.productTruthStale).toBe(false);
      expect(next.strategistBriefStale).toBe(false);
    });

    it('does not mark stale when there is no product truth', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1']),
        conceptCandidates: [
          {
            id: 'c1',
            title: 'Concept',
            oneLineIdea: 'Idea',
            visualDirection: 'Dir',
            brandFitRationale: 'Fit',
            productTruthNotes: [],
            suggestedReferenceRoles: [],
            sourceTrendInsightIds: [],
            status: 'candidate',
          },
        ],
      };
      const next = studioReducer(state, { type: 'TOGGLE_SELECT', id: 'a2' });
      expect(next.productTruthStale).toBe(false);
      expect(next.conceptCandidates[0].status).toBe('candidate');
    });
  });

  describe('SET_MULTI_SELECT', () => {
    it('enables multi-select mode', () => {
      const next = studioReducer(initialState, { type: 'SET_MULTI_SELECT', enabled: true });
      expect(next.multiSelectEnabled).toBe(true);
    });

    it('disabling multi-select clears gallery selection', () => {
      const state: StudioState = {
        ...initialState,
        multiSelectEnabled: true,
        gallerySelectionIds: new Set(['a1', 'a2']),
      };
      const next = studioReducer(state, { type: 'SET_MULTI_SELECT', enabled: false });
      expect(next.multiSelectEnabled).toBe(false);
      expect(next.gallerySelectionIds.size).toBe(0);
    });
  });

  describe('SET_DETAIL_ASSET', () => {
    it('sets the detail asset id', () => {
      const next = studioReducer(initialState, { type: 'SET_DETAIL_ASSET', id: 'a1' });
      expect(next.detailAssetId).toBe('a1');
    });

    it('clears the detail asset id', () => {
      const state: StudioState = { ...initialState, detailAssetId: 'a1' };
      const next = studioReducer(state, { type: 'SET_DETAIL_ASSET', id: null });
      expect(next.detailAssetId).toBeNull();
    });
  });

  describe('SET_VIEW_MODE', () => {
    it('sets view mode to compact', () => {
      const next = studioReducer(initialState, { type: 'SET_VIEW_MODE', mode: 'compact' });
      expect(next.viewMode).toBe('compact');
    });
  });

  describe('SET_CREATIVE_ROUTE', () => {
    it('sets the creative route', () => {
      const next = studioReducer(initialState, { type: 'SET_CREATIVE_ROUTE', route: 'ai_upgrade' });
      expect(next.creativeRoute).toBe('ai_upgrade');
    });

    it('assigns default product role to selected assets when entering composite', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2']),
        roleAssignments: new Map(),
      };
      const next = studioReducer(state, { type: 'SET_CREATIVE_ROUTE', route: 'composite' });
      expect(next.creativeRoute).toBe('composite');
      expect(next.roleAssignments.get('a1')).toEqual({ role: 'product' });
      expect(next.roleAssignments.get('a2')).toEqual({ role: 'product' });
    });

    it('preserves existing role assignments when entering composite', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2']),
        roleAssignments: new Map([['a1', { role: 'person', preserve: 'face' }]]),
      };
      const next = studioReducer(state, { type: 'SET_CREATIVE_ROUTE', route: 'composite' });
      expect(next.roleAssignments.get('a1')).toEqual({ role: 'person', preserve: 'face' });
      expect(next.roleAssignments.get('a2')).toEqual({ role: 'product' });
    });
  });

  describe('SET_ASPECT_RATIO', () => {
    it('sets the aspect ratio', () => {
      const next = studioReducer(initialState, { type: 'SET_ASPECT_RATIO', ratio: '1:1' });
      expect(next.aspectRatio).toBe('1:1');
    });
  });

  describe('SET_PROMPT', () => {
    it('sets the prompt text', () => {
      const next = studioReducer(initialState, { type: 'SET_PROMPT', text: 'A beautiful sunset' });
      expect(next.prompt).toBe('A beautiful sunset');
    });
  });

  describe('SET_ROLE', () => {
    it('updates role for existing assignment', () => {
      const state: StudioState = {
        ...initialState,
        roleAssignments: new Map([['a1', { role: 'product' }]]),
      };
      const next = studioReducer(state, { type: 'SET_ROLE', assetId: 'a1', role: 'environment' });
      expect(next.roleAssignments.get('a1')?.role).toBe('environment');
    });

    it('creates new assignment with specified role if none exists', () => {
      const next = studioReducer(initialState, { type: 'SET_ROLE', assetId: 'a1', role: 'style_guide' });
      expect(next.roleAssignments.get('a1')).toEqual({ role: 'style_guide' });
    });
  });

  describe('SET_ROLE_INSTRUCTIONS', () => {
    it('updates instructions for existing assignment', () => {
      const state: StudioState = {
        ...initialState,
        roleAssignments: new Map([['a1', { role: 'person' }]]),
      };
      const next = studioReducer(state, {
        type: 'SET_ROLE_INSTRUCTIONS',
        assetId: 'a1',
        preserve: 'face details',
        modify: 'background',
      });
      expect(next.roleAssignments.get('a1')).toEqual({
        role: 'person',
        preserve: 'face details',
        modify: 'background',
      });
    });

    it('creates new assignment with default product role if none exists', () => {
      const next = studioReducer(initialState, {
        type: 'SET_ROLE_INSTRUCTIONS',
        assetId: 'a1',
        preserve: 'logo',
      });
      expect(next.roleAssignments.get('a1')).toEqual({
        role: 'product',
        preserve: 'logo',
        modify: undefined,
      });
    });
  });

  describe('GENERATION_START', () => {
    it('sets isGenerating to true', () => {
      const next = studioReducer(initialState, { type: 'GENERATION_START' });
      expect(next.isGenerating).toBe(true);
    });
  });

  describe('GENERATION_SUCCESS', () => {
    it('prepends asset at index 0 and adds history entry', () => {
      const existing = makeAsset({ id: 'existing' });
      const state: StudioState = { ...initialState, assets: [existing], isGenerating: true };
      const newAsset = makeAsset({ id: 'generated', source: 'generated' });
      const entry = makeHistoryEntry({ id: 'h1' });

      const next = studioReducer(state, {
        type: 'GENERATION_SUCCESS',
        asset: newAsset,
        historyEntry: entry,
      });

      expect(next.isGenerating).toBe(false);
      expect(next.assets[0].id).toBe('generated');
      expect(next.assets[1].id).toBe('existing');
      expect(next.history[0].id).toBe('h1');
    });

    it('enforces max 50 history entries', () => {
      const history = Array.from({ length: 50 }, (_, i) => makeHistoryEntry({ id: `h${i}` }));
      const state: StudioState = { ...initialState, history, isGenerating: true };
      const newAsset = makeAsset({ id: 'new' });
      const entry = makeHistoryEntry({ id: 'h-new' });

      const next = studioReducer(state, {
        type: 'GENERATION_SUCCESS',
        asset: newAsset,
        historyEntry: entry,
      });

      expect(next.history).toHaveLength(50);
      expect(next.history[0].id).toBe('h-new');
      // The oldest entry (h49) should be evicted
      expect(next.history[49].id).toBe('h48');
    });
  });

  describe('GENERATION_FAILURE', () => {
    it('does not modify assets, adds history entry', () => {
      const existing = makeAsset({ id: 'existing' });
      const state: StudioState = { ...initialState, assets: [existing], isGenerating: true };
      const entry = makeHistoryEntry({ id: 'h-fail', status: 'failure', errorMessage: 'timeout' });

      const next = studioReducer(state, {
        type: 'GENERATION_FAILURE',
        error: 'timeout',
        historyEntry: entry,
      });

      expect(next.isGenerating).toBe(false);
      expect(next.assets).toHaveLength(1);
      expect(next.assets[0].id).toBe('existing');
      expect(next.history[0].id).toBe('h-fail');
    });

    it('enforces max 50 history entries on failure', () => {
      const history = Array.from({ length: 50 }, (_, i) => makeHistoryEntry({ id: `h${i}` }));
      const state: StudioState = { ...initialState, history, isGenerating: true };
      const entry = makeHistoryEntry({ id: 'h-fail', status: 'failure' });

      const next = studioReducer(state, {
        type: 'GENERATION_FAILURE',
        error: 'error',
        historyEntry: entry,
      });

      expect(next.history).toHaveLength(50);
      expect(next.history[0].id).toBe('h-fail');
    });
  });

  describe('SET_GENERATING', () => {
    it('sets isGenerating flag', () => {
      const next = studioReducer(initialState, { type: 'SET_GENERATING', generating: true });
      expect(next.isGenerating).toBe(true);
    });
  });

  describe('SET_ENHANCING', () => {
    it('sets isEnhancing flag', () => {
      const next = studioReducer(initialState, { type: 'SET_ENHANCING', enhancing: true });
      expect(next.isEnhancing).toBe(true);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Gallery selection (independent of composer references)
  // -------------------------------------------------------------------------

  describe('GALLERY_TOGGLE_SELECT', () => {
    it('adds an asset id to gallerySelectionIds', () => {
      const next = studioReducer(initialState, { type: 'GALLERY_TOGGLE_SELECT', id: 'a1' });
      expect(next.gallerySelectionIds.has('a1')).toBe(true);
    });

    it('removes an asset id from gallerySelectionIds when already present', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1']),
      };
      const next = studioReducer(state, { type: 'GALLERY_TOGGLE_SELECT', id: 'a1' });
      expect(next.gallerySelectionIds.has('a1')).toBe(false);
    });

    it('can add another id without clearing existing selection', () => {
      const state: StudioState = { ...initialState, gallerySelectionIds: new Set(['a1']) };
      const next = studioReducer(state, { type: 'GALLERY_TOGGLE_SELECT', id: 'a2' });
      expect(next.gallerySelectionIds.has('a2')).toBe(true);
      expect(next.gallerySelectionIds.has('a1')).toBe(true);
    });

    it('rejects selection when already at max (100)', () => {
      const ids = Array.from({ length: 100 }, (_, i) => `a${i}`);
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(ids),
      };
      const next = studioReducer(state, { type: 'GALLERY_TOGGLE_SELECT', id: 'new-asset' });
      expect(next).toBe(state);
    });
  });

  describe('GALLERY_CLEAR_SELECTION', () => {
    it('empties gallerySelectionIds', () => {
      const state: StudioState = {
        ...initialState,
        gallerySelectionIds: new Set(['a1', 'a2']),
      };
      const next = studioReducer(state, { type: 'GALLERY_CLEAR_SELECTION' });
      expect(next.gallerySelectionIds.size).toBe(0);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Composer references
  // -------------------------------------------------------------------------

  describe('ADD_COMPOSER_REFERENCE', () => {
    it('adds a reference to composerReferences', () => {
      const ref = { assetId: 'a1', role: 'include' as const };
      const next = studioReducer(initialState, { type: 'ADD_COMPOSER_REFERENCE', reference: ref });
      expect(next.composerReferences).toHaveLength(1);
      expect(next.composerReferences[0].assetId).toBe('a1');
    });

    it('is idempotent — does not add a duplicate reference for the same assetId', () => {
      const ref = { assetId: 'a1', role: 'include' as const };
      let state = studioReducer(initialState, { type: 'ADD_COMPOSER_REFERENCE', reference: ref });
      state = studioReducer(state, { type: 'ADD_COMPOSER_REFERENCE', reference: ref });
      expect(state.composerReferences).toHaveLength(1);
    });
  });

  describe('UPDATE_COMPOSER_REFERENCE', () => {
    it('updates the role of an existing reference', () => {
      const state: StudioState = {
        ...initialState,
        composerReferences: [{ assetId: 'a1', role: 'include' }],
      };
      const next = studioReducer(state, {
        type: 'UPDATE_COMPOSER_REFERENCE',
        assetId: 'a1',
        updates: { role: 'style' },
      });
      expect(next.composerReferences[0].role).toBe('style');
    });

    it('updates instructions without changing the role', () => {
      const state: StudioState = {
        ...initialState,
        composerReferences: [{ assetId: 'a1', role: 'product' }],
      };
      const next = studioReducer(state, {
        type: 'UPDATE_COMPOSER_REFERENCE',
        assetId: 'a1',
        updates: { instructions: 'preserve the logo' },
      });
      expect(next.composerReferences[0].role).toBe('product');
      expect(next.composerReferences[0].instructions).toBe('preserve the logo');
    });
  });

  describe('REMOVE_COMPOSER_REFERENCE', () => {
    it('removes the matching reference', () => {
      const state: StudioState = {
        ...initialState,
        composerReferences: [
          { assetId: 'a1', role: 'include' },
          { assetId: 'a2', role: 'style' },
        ],
      };
      const next = studioReducer(state, { type: 'REMOVE_COMPOSER_REFERENCE', assetId: 'a1' });
      expect(next.composerReferences).toHaveLength(1);
      expect(next.composerReferences[0].assetId).toBe('a2');
    });
  });

  describe('SET_COMPOSER_REFERENCE_ROLE', () => {
    it('updates only the role of the targeted reference', () => {
      const state: StudioState = {
        ...initialState,
        composerReferences: [
          { assetId: 'a1', role: 'include', instructions: 'test' },
          { assetId: 'a2', role: 'style' },
        ],
      };
      const next = studioReducer(state, {
        type: 'SET_COMPOSER_REFERENCE_ROLE',
        assetId: 'a1',
        role: 'product',
      });
      expect(next.composerReferences[0].role).toBe('product');
      expect(next.composerReferences[0].instructions).toBe('test');
      expect(next.composerReferences[1].role).toBe('style');
    });
  });

  describe('CLEAR_COMPOSER_REFERENCES', () => {
    it('empties the composerReferences array', () => {
      const state: StudioState = {
        ...initialState,
        composerReferences: [
          { assetId: 'a1', role: 'include' },
          { assetId: 'a2', role: 'style' },
        ],
      };
      const next = studioReducer(state, { type: 'CLEAR_COMPOSER_REFERENCES' });
      expect(next.composerReferences).toHaveLength(0);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Gallery selection does not affect composer references
  // -------------------------------------------------------------------------

  it('gallery selection and composer references are independent', () => {
    const ref = { assetId: 'a1', role: 'product' as const };
    let state = studioReducer(initialState, { type: 'ADD_COMPOSER_REFERENCE', reference: ref });
    state = studioReducer(state, { type: 'GALLERY_TOGGLE_SELECT', id: 'a2' });

    expect(state.composerReferences).toHaveLength(1);
    expect(state.composerReferences[0].assetId).toBe('a1');
    expect(state.gallerySelectionIds.has('a2')).toBe(true);
    expect(state.gallerySelectionIds.has('a1')).toBe(false);
  });

  // -------------------------------------------------------------------------
  // Phase 1: Active document
  // -------------------------------------------------------------------------

  describe('OPEN_DOCUMENT', () => {
    it('sets activeDocument', () => {
      const doc = { id: 'd1', rootAssetId: 'a1', activeVersionId: 'v1', versionIds: ['v1'] };
      const next = studioReducer(initialState, { type: 'OPEN_DOCUMENT', document: doc });
      expect(next.activeDocument).toEqual(doc);
    });
  });

  describe('CLOSE_DOCUMENT', () => {
    it('clears activeDocument', () => {
      const state: StudioState = {
        ...initialState,
        activeDocument: { id: 'd1', rootAssetId: 'a1', activeVersionId: 'v1', versionIds: ['v1'] },
      };
      const next = studioReducer(state, { type: 'CLOSE_DOCUMENT' });
      expect(next.activeDocument).toBeUndefined();
    });
  });

  describe('UPDATE_DOCUMENT', () => {
    it('updates activeVersionId of the active document', () => {
      const state: StudioState = {
        ...initialState,
        activeDocument: { id: 'd1', rootAssetId: 'a1', activeVersionId: 'v1', versionIds: ['v1'] },
      };
      const next = studioReducer(state, {
        type: 'UPDATE_DOCUMENT',
        updates: { activeVersionId: 'v2', versionIds: ['v1', 'v2'] },
      });
      expect(next.activeDocument?.activeVersionId).toBe('v2');
      expect(next.activeDocument?.versionIds).toEqual(['v1', 'v2']);
    });

    it('is a no-op if no active document', () => {
      const next = studioReducer(initialState, {
        type: 'UPDATE_DOCUMENT',
        updates: { activeVersionId: 'v2' },
      });
      expect(next).toBe(initialState);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Generation versions
  // -------------------------------------------------------------------------

  describe('ADD_VERSION', () => {
    it('appends a version to the versions array', () => {
      const version = {
        id: 'v1',
        outputAssetId: 'a1',
        prompt: 'test',
        inferredOperation: 'generate' as const,
        referenceSnapshot: [],
        createdAt: new Date().toISOString(),
      };
      const next = studioReducer(initialState, { type: 'ADD_VERSION', version });
      expect(next.versions).toHaveLength(1);
      expect(next.versions[0].id).toBe('v1');
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Product truth
  // -------------------------------------------------------------------------

  describe('SET_PRODUCT_TRUTH', () => {
    it('sets productTruth on the state', () => {
      const pt = {
        id: 'pt-1',
        productName: 'TestBrand',
        protectedAssetIds: [],
        preservationRules: ['Preserve logo'],
        verifiedFacts: [],
        unresolvedQuestions: [],
        userCorrections: [],
      };
      const next = studioReducer(initialState, { type: 'SET_PRODUCT_TRUTH', productTruth: pt });
      expect(next.productTruth?.productName).toBe('TestBrand');
    });
  });

  describe('CLEAR_PRODUCT_TRUTH', () => {
    it('removes productTruth from the state', () => {
      const state: StudioState = {
        ...initialState,
        productTruth: {
          id: 'pt-1',
          productName: 'TestBrand',
          protectedAssetIds: [],
          preservationRules: [],
          verifiedFacts: [],
          unresolvedQuestions: [],
          userCorrections: [],
        },
      };
      const next = studioReducer(state, { type: 'CLEAR_PRODUCT_TRUTH' });
      expect(next.productTruth).toBeUndefined();
    });
  });

  describe('ADD_PRODUCT_TRUTH_CORRECTION', () => {
    it('appends a correction to userCorrections', () => {
      const state: StudioState = {
        ...initialState,
        productTruth: {
          id: 'pt-1',
          productName: 'TestBrand',
          protectedAssetIds: [],
          preservationRules: [],
          verifiedFacts: [],
          unresolvedQuestions: [],
          userCorrections: [],
        },
      };
      const next = studioReducer(state, {
        type: 'ADD_PRODUCT_TRUTH_CORRECTION',
        correction: 'The blue variant is discontinued',
      });
      expect(next.productTruth?.userCorrections).toHaveLength(1);
      expect(next.productTruth?.userCorrections[0]).toBe('The blue variant is discontinued');
    });

    it('is a no-op if no productTruth exists', () => {
      const next = studioReducer(initialState, {
        type: 'ADD_PRODUCT_TRUTH_CORRECTION',
        correction: 'test',
      });
      expect(next).toBe(initialState);
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Brand Knowledge with invalidation
  // -------------------------------------------------------------------------

  describe('SET_BRAND_KNOWLEDGE', () => {
    it('sets brand knowledge and clears stale brand-dependent context', () => {
      const state: StudioState = {
        ...initialState,
        trendResearch: {
          id: 'tr-1',
          brandKnowledgeId: 'old-brand',
          query: 'old trends',
          platform: 'instagram_feed',
          objective: 'awareness',
          researchedAt: '2026-06-08T00:00:00.000Z',
          expiresAt: '2026-06-22T00:00:00.000Z',
          sources: [],
          insights: [],
        },
        conceptCandidates: [
          {
            id: 'concept-1',
            title: 'Old concept',
            oneLineIdea: 'Test',
            visualDirection: 'Test',
            brandFitRationale: 'Test',
            productTruthNotes: [],
            suggestedReferenceRoles: [],
            sourceTrendInsightIds: [],
            status: 'candidate',
          },
        ],
        selectedConceptId: 'concept-1',
        socialPostDraft: {
          id: 'draft-1',
          platform: 'instagram_feed',
          objective: 'awareness',
          heroAssetId: 'a1',
          supportingAssetIds: [],
          aspectRatio: '9:16',
          layout: { templateId: 't1', safeZones: [] },
          typography: {},
          copy: { headline: 'Test', caption: 'Test', hashtags: [] },
          generationBrief: 'Test',
        },
        activeDirection: {
          id: 'direction-1',
          title: 'Old direction',
          rationale: 'Old rationale',
          productionBrief: 'Old brief',
        },
      };

      const next = studioReducer(state, {
        type: 'SET_BRAND_KNOWLEDGE',
        brandKnowledge: {
          id: 'new-brand',
          sourceUrls: ['https://example.com'],
          sources: [],
          brandName: { value: 'Example', status: 'verified', confidence: 1, sourceIds: [] },
          fonts: [],
          colors: [],
          logoRules: [],
          visualPrinciples: [],
          toneAttributes: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
      });

      expect(next.brandKnowledge?.brandName.value).toBe('Example');
      expect(next.brandUrlInput).toBe('https://example.com');
      expect(next.trendResearch).toBeUndefined();
      expect(next.conceptCandidates).toHaveLength(0);
      expect(next.selectedConceptId).toBeUndefined();
      expect(next.socialPostDraft).toBeUndefined();
      expect(next.activeDirection).toBeUndefined();
    });
  });

  describe('SET_BRAND_URL_INPUT', () => {
    it('stores the shared editable brand URL', () => {
      const next = studioReducer(initialState, {
        type: 'SET_BRAND_URL_INPUT',
        text: 'https://kageha.ca',
      });
      expect(next.brandUrlInput).toBe('https://kageha.ca');
    });
  });

  describe('CLEAR_BRAND_KNOWLEDGE', () => {
    it('clears brand knowledge and dependent context', () => {
      const state: StudioState = {
        ...initialState,
        brandUrlInput: 'https://kageha.ca',
        brandKnowledge: {
          id: 'brand-1',
          sourceUrls: ['https://kageha.ca'],
          sources: [],
          brandName: { value: 'Test', status: 'verified', confidence: 1, sourceIds: [] },
          fonts: [],
          colors: [],
          logoRules: [],
          visualPrinciples: [],
          toneAttributes: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: '2026-06-08T00:00:00.000Z',
        },
        conceptCandidates: [{ id: 'c1', title: 'Test', oneLineIdea: 'Test', visualDirection: 'Test', brandFitRationale: 'Test', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' }],
      };

      const next = studioReducer(state, { type: 'CLEAR_BRAND_KNOWLEDGE' });
      expect(next.brandKnowledge).toBeUndefined();
      expect(next.conceptCandidates).toHaveLength(0);
      expect(next.brandUrlInput).toBe('https://kageha.ca');
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Concept candidates with invalidation
  // -------------------------------------------------------------------------

  describe('SET_CONCEPT_CANDIDATES', () => {
    it('sets concept candidates and clears selected/social draft', () => {
      const state: StudioState = {
        ...initialState,
        selectedConceptId: 'old-concept',
        socialPostDraft: { id: 'draft-1', platform: 'instagram_feed', objective: 'awareness', heroAssetId: 'a1', supportingAssetIds: [], aspectRatio: '9:16', layout: { templateId: 't1', safeZones: [] }, typography: {}, copy: { headline: 'Test', caption: 'Test', hashtags: [] }, generationBrief: 'Test' },
      };

      const concepts = [
        { id: 'c1', title: 'Concept 1', oneLineIdea: 'Idea 1', visualDirection: 'Direction 1', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' as const },
        { id: 'c2', title: 'Concept 2', oneLineIdea: 'Idea 2', visualDirection: 'Direction 2', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' as const },
      ];

      const next = studioReducer(state, { type: 'SET_CONCEPT_CANDIDATES', concepts });
      expect(next.conceptCandidates).toHaveLength(2);
      expect(next.selectedConceptId).toBeUndefined();
      expect(next.socialPostDraft).toBeUndefined();
    });
  });

  describe('SELECT_CONCEPT', () => {
    it('marks concept as selected and clears social draft', () => {
      const state: StudioState = {
        ...initialState,
        conceptCandidates: [
          { id: 'c1', title: 'Concept 1', oneLineIdea: 'Idea 1', visualDirection: 'Direction 1', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
          { id: 'c2', title: 'Concept 2', oneLineIdea: 'Idea 2', visualDirection: 'Direction 2', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
        ],
        socialPostDraft: { id: 'draft-1', platform: 'instagram_feed', objective: 'awareness', heroAssetId: 'a1', supportingAssetIds: [], aspectRatio: '9:16', layout: { templateId: 't1', safeZones: [] }, typography: {}, copy: { headline: 'Test', caption: 'Test', hashtags: [] }, generationBrief: 'Test' },
      };

      const next = studioReducer(state, { type: 'SELECT_CONCEPT', conceptId: 'c2' });
      expect(next.selectedConceptId).toBe('c2');
      expect(next.conceptCandidates[1].status).toBe('selected');
      expect(next.socialPostDraft).toBeUndefined();
    });
  });

  describe('REJECT_CONCEPT', () => {
    it('marks concept as rejected', () => {
      const state: StudioState = {
        ...initialState,
        conceptCandidates: [
          { id: 'c1', title: 'Concept 1', oneLineIdea: 'Idea 1', visualDirection: 'Direction 1', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
        ],
      };

      const next = studioReducer(state, { type: 'REJECT_CONCEPT', conceptId: 'c1' });
      expect(next.conceptCandidates[0].status).toBe('rejected');
    });
  });

  describe('MARK_CONCEPTS_STALE', () => {
    it('marks all candidate concepts as stale', () => {
      const state: StudioState = {
        ...initialState,
        conceptCandidates: [
          { id: 'c1', title: 'Concept 1', oneLineIdea: 'Idea 1', visualDirection: 'Direction 1', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
          { id: 'c2', title: 'Concept 2', oneLineIdea: 'Idea 2', visualDirection: 'Direction 2', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'selected' },
          { id: 'c3', title: 'Concept 3', oneLineIdea: 'Idea 3', visualDirection: 'Direction 3', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'rejected' },
        ],
      };

      const next = studioReducer(state, { type: 'MARK_CONCEPTS_STALE' });
      expect(next.conceptCandidates[0].status).toBe('stale');
      expect(next.conceptCandidates[1].status).toBe('selected'); // selected remains selected
      expect(next.conceptCandidates[2].status).toBe('rejected'); // rejected remains rejected
    });
  });

  describe('SET_PROMPT invalidation', () => {
    it('marks concepts stale when user direction changes', () => {
      const state: StudioState = {
        ...initialState,
        conceptCandidates: [
          { id: 'c1', title: 'Concept 1', oneLineIdea: 'Idea 1', visualDirection: 'Direction 1', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' },
          { id: 'c2', title: 'Concept 2', oneLineIdea: 'Idea 2', visualDirection: 'Direction 2', brandFitRationale: 'Fit', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'selected' },
        ],
      };

      const next = studioReducer(state, { type: 'SET_PROMPT', text: 'New direction' });
      expect(next.prompt).toBe('New direction');
      expect(next.conceptCandidates[0].status).toBe('stale');
      expect(next.conceptCandidates[1].status).toBe('selected'); // selected remains selected
    });

    it('clears a social draft when user direction changes', () => {
      const state: StudioState = {
        ...initialState,
        socialPostDraft: { id: 'draft-1', platform: 'instagram_feed', objective: 'awareness', heroAssetId: 'a1', supportingAssetIds: [], aspectRatio: '9:16', layout: { templateId: 't1', safeZones: [] }, typography: {}, copy: { headline: 'Test', caption: 'Test', hashtags: [] }, generationBrief: 'Test' },
      };

      const next = studioReducer(state, { type: 'SET_PROMPT', text: 'New direction' });
      expect(next.socialPostDraft).toBeUndefined();
    });
  });

  describe('Composer reference invalidation', () => {
    it('ADD_COMPOSER_REFERENCE clears concepts and social draft', () => {
      const state: StudioState = {
        ...initialState,
        conceptCandidates: [{ id: 'c1', title: 'Test', oneLineIdea: 'Test', visualDirection: 'Test', brandFitRationale: 'Test', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' }],
        selectedConceptId: 'c1',
        socialPostDraft: { id: 'draft-1', platform: 'instagram_feed', objective: 'awareness', heroAssetId: 'a1', supportingAssetIds: [], aspectRatio: '9:16', layout: { templateId: 't1', safeZones: [] }, typography: {}, copy: { headline: 'Test', caption: 'Test', hashtags: [] }, generationBrief: 'Test' },
      };

      const next = studioReducer(state, { type: 'ADD_COMPOSER_REFERENCE', reference: { assetId: 'a1', role: 'product' } });
      expect(next.composerReferences).toHaveLength(1);
      expect(next.conceptCandidates).toHaveLength(0);
      expect(next.selectedConceptId).toBeUndefined();
      expect(next.socialPostDraft).toBeUndefined();
    });

    it('is idempotent even when invalidating', () => {
      const ref = { assetId: 'a1', role: 'include' as const };
      let state = studioReducer(initialState, { type: 'ADD_COMPOSER_REFERENCE', reference: ref });
      state = studioReducer(state, { type: 'SET_CONCEPT_CANDIDATES', concepts: [{ id: 'c1', title: 'Test', oneLineIdea: 'Test', visualDirection: 'Test', brandFitRationale: 'Test', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: [], status: 'candidate' }] });

      // Second add of same reference should be no-op and NOT invalidate
      const next = studioReducer(state, { type: 'ADD_COMPOSER_REFERENCE', reference: ref });
      expect(next.composerReferences).toHaveLength(1);
      expect(next.conceptCandidates).toHaveLength(1); // not cleared because it was a no-op
    });
  });

  // -------------------------------------------------------------------------
  // Phase 1: Social Post Draft
  // -------------------------------------------------------------------------

  describe('SET_SOCIAL_POST_DRAFT', () => {
    it('sets the social post draft', () => {
      const draft = {
        id: 'draft-1',
        platform: 'instagram_feed' as const,
        objective: 'awareness' as const,
        heroAssetId: 'a1',
        supportingAssetIds: [],
        aspectRatio: '9:16' as const,
        layout: { templateId: 't1', safeZones: [] },
        typography: {},
        copy: { headline: 'Headline', caption: 'Caption', hashtags: ['#test'] },
        generationBrief: 'Generate with headline',
      };

      const next = studioReducer(initialState, { type: 'SET_SOCIAL_POST_DRAFT', draft });
      expect(next.socialPostDraft?.copy.headline).toBe('Headline');
      expect(next.socialPostDraft?.platform).toBe('instagram_feed');
    });

    it('updates editable social draft fields', () => {
      const draft = { id: 'draft-1', platform: 'instagram_feed' as const, objective: 'awareness' as const, heroAssetId: 'a1', supportingAssetIds: [], aspectRatio: '9:16' as const, layout: { templateId: 't1', safeZones: [] }, typography: {}, copy: { headline: 'Old', caption: 'Old caption', hashtags: [] }, generationBrief: 'Old brief' };
      const state = studioReducer(initialState, { type: 'SET_SOCIAL_POST_DRAFT', draft });
      const next = studioReducer(state, {
        type: 'UPDATE_SOCIAL_POST_DRAFT',
        updates: { copy: { ...draft.copy, headline: 'New' }, generationBrief: 'New brief' },
      });

      expect(next.socialPostDraft?.copy.headline).toBe('New');
      expect(next.socialPostDraft?.generationBrief).toBe('New brief');
    });
  });

  describe('SET_CAPTION_PACK', () => {
    it('sets and updates a caption pack', () => {
      const pack = {
        caption: 'Sip slowly.',
        hashtags: ['matcha'],
        generatedAt: '2026-07-12T00:00:00.000Z',
        usedWebResearch: false,
        sourceAssetId: 'a1',
      };
      const state = studioReducer(initialState, { type: 'SET_CAPTION_PACK', captionPack: pack });
      expect(state.captionPack?.caption).toBe('Sip slowly.');

      const next = studioReducer(state, {
        type: 'UPDATE_CAPTION_PACK',
        updates: { caption: 'Edited caption', hashtags: ['matcha', 'calm'] },
      });
      expect(next.captionPack?.caption).toBe('Edited caption');
      expect(next.captionPack?.hashtags).toEqual(['matcha', 'calm']);

      const cleared = studioReducer(next, { type: 'CLEAR_CAPTION_PACK' });
      expect(cleared.captionPack).toBeUndefined();
    });
  });

  describe('SET_STRATEGIST_BRIEF', () => {
    it('stores the brief and clears it when brand knowledge changes', () => {
      const brief = {
        id: 'brief-1',
        campaignGoal: 'Launch matcha',
        executionMode: 'hybrid' as const,
        summary: 'Calm launch brief',
        brandFit: 'Kageha',
        productFit: 'Tin',
        trendAngles: [],
        preservationPriorities: [],
        creativeTerritories: ['Product-hero'],
        constraints: [],
        openQuestions: [],
        sourceInsightIds: [],
        createdAt: '2026-07-12T00:00:00.000Z',
      };
      const withBrief = studioReducer(initialState, { type: 'SET_STRATEGIST_BRIEF', brief });
      expect(withBrief.strategistBrief?.summary).toBe('Calm launch brief');

      const afterBrand = studioReducer(withBrief, {
        type: 'SET_BRAND_KNOWLEDGE',
        brandKnowledge: {
          id: 'b1',
          brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
          sourceUrls: [],
          sources: [],
          fonts: [],
          colors: [],
          logoRules: [],
          visualPrinciples: [],
          toneAttributes: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
      });
      expect(afterBrand.strategistBrief).toBeUndefined();
    });
  });

  describe('SET_PRODUCTION_BRIEF', () => {
    const productionBrief = {
      summary: 'Production brief for "Quiet Matcha Ritual" | Mode: recreate',
      generationPrompt: 'PRESERVATION REQUIREMENTS\n- CRITICAL: Preserve tin label',
      preservationInstructions: ['CRITICAL: Preserve tin label'],
      referenceRoles: [],
      recommendedAspectRatio: '9:16' as const,
      avoidList: ['Avoid generic stock photo aesthetic'],
      provenance: {
        preservationFrom: 'Product Truth',
        conceptFrom: 'Selected concept: Quiet Matcha Ritual',
      },
    };

    it('stores, updates, and clears the production brief', () => {
      const withBrief = studioReducer(initialState, {
        type: 'SET_PRODUCTION_BRIEF',
        brief: productionBrief,
      });
      expect(withBrief.productionBrief?.summary).toContain('Quiet Matcha Ritual');

      const updated = studioReducer(withBrief, {
        type: 'UPDATE_PRODUCTION_BRIEF',
        updates: { generationPrompt: 'Edited prompt' },
      });
      expect(updated.productionBrief?.generationPrompt).toBe('Edited prompt');
      expect(updated.productionBrief?.summary).toContain('Quiet Matcha Ritual');

      const cleared = studioReducer(updated, { type: 'CLEAR_PRODUCTION_BRIEF' });
      expect(cleared.productionBrief).toBeUndefined();
    });

    it('clears on concept select and brand knowledge change', () => {
      const withBrief = studioReducer(initialState, {
        type: 'SET_PRODUCTION_BRIEF',
        brief: productionBrief,
      });

      const afterSelect = studioReducer(withBrief, {
        type: 'SELECT_CONCEPT',
        conceptId: 'concept-1',
      });
      expect(afterSelect.productionBrief).toBeUndefined();

      const restored = studioReducer(initialState, {
        type: 'SET_PRODUCTION_BRIEF',
        brief: productionBrief,
      });
      const afterBrand = studioReducer(restored, {
        type: 'SET_BRAND_KNOWLEDGE',
        brandKnowledge: {
          id: 'b1',
          brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
          sourceUrls: [],
          sources: [],
          fonts: [],
          colors: [],
          logoRules: [],
          visualPrinciples: [],
          toneAttributes: [],
          approvedLanguage: [],
          prohibitedLanguage: [],
          imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
          updatedAt: '2026-07-12T00:00:00.000Z',
        },
      });
      expect(afterBrand.productionBrief).toBeUndefined();
    });
  });

  describe('EXCLUDE_TREND_INSIGHT', () => {
    it('removes the insight and invalidates concepts sourced from it', () => {
      const state: StudioState = {
        ...initialState,
        trendResearch: {
          id: 'trend',
          query: 'test',
          insights: [{ id: 'insight-1', title: 'Trend', description: '', applicability: '', risk: '', confidence: 0.8, sourceIds: [] }],
          sources: [],
          researchedAt: '',
          expiresAt: '',
        },
        conceptCandidates: [{ id: 'concept', title: 'Concept', oneLineIdea: '', visualDirection: '', brandFitRationale: '', productTruthNotes: [], suggestedReferenceRoles: [], sourceTrendInsightIds: ['insight-1'], status: 'selected' }],
        selectedConceptId: 'concept',
        socialPostDraft: { id: 'draft' } as StudioState['socialPostDraft'],
      };

      const next = studioReducer(state, { type: 'EXCLUDE_TREND_INSIGHT', insightId: 'insight-1' });
      expect(next.trendResearch?.insights).toHaveLength(0);
      expect(next.conceptCandidates[0].status).toBe('stale');
      expect(next.selectedConceptId).toBeUndefined();
      expect(next.socialPostDraft).toBeUndefined();
    });
  });

  describe('CLEAR_SOCIAL_POST_DRAFT', () => {
    it('clears the social post draft', () => {
      const state: StudioState = {
        ...initialState,
        socialPostDraft: { id: 'draft-1', platform: 'instagram_feed', objective: 'awareness', heroAssetId: 'a1', supportingAssetIds: [], aspectRatio: '9:16', layout: { templateId: 't1', safeZones: [] }, typography: {}, copy: { headline: 'Test', caption: 'Test', hashtags: [] }, generationBrief: 'Test' },
      };

      const next = studioReducer(state, { type: 'CLEAR_SOCIAL_POST_DRAFT' });
      expect(next.socialPostDraft).toBeUndefined();
    });
  });

  describe('REPLACE_STATE', () => {
    it('replaces the full studio state and clears generation flags', () => {
      const current = studioReducer(initialState, {
        type: 'ADD_ASSETS',
        assets: [makeAsset({ id: 'old' })],
      });
      const replacement: StudioState = {
        ...initialState,
        prompt: 'Loaded project prompt',
        assets: [makeAsset({ id: 'new' })],
        isGenerating: true,
        isEnhancing: true,
      };
      const next = studioReducer(current, { type: 'REPLACE_STATE', state: replacement });
      expect(next.assets.map((a) => a.id)).toEqual(['new']);
      expect(next.prompt).toBe('Loaded project prompt');
      expect(next.isGenerating).toBe(false);
      expect(next.isEnhancing).toBe(false);
    });
  });

  describe('post queue (selection order)', () => {
    it('appends on toggle in click order and removes on second toggle', () => {
      let state = studioReducer(initialState, { type: 'POST_QUEUE_TOGGLE', id: 'b' });
      state = studioReducer(state, { type: 'POST_QUEUE_TOGGLE', id: 'a' });
      state = studioReducer(state, { type: 'POST_QUEUE_TOGGLE', id: 'c' });
      expect(state.postQueueIds).toEqual(['b', 'a', 'c']);
      state = studioReducer(state, { type: 'POST_QUEUE_TOGGLE', id: 'a' });
      expect(state.postQueueIds).toEqual(['b', 'c']);
    });

    it('reorders slides without changing membership', () => {
      const state: StudioState = {
        ...initialState,
        postQueueIds: ['a', 'b', 'c'],
      };
      const next = studioReducer(state, {
        type: 'POST_QUEUE_REORDER',
        fromIndex: 2,
        toIndex: 0,
      });
      expect(next.postQueueIds).toEqual(['c', 'a', 'b']);
    });

    it('prunes queue when asset is removed', () => {
      const state: StudioState = {
        ...initialState,
        assets: [makeAsset({ id: 'a1' }), makeAsset({ id: 'a2' })],
        postQueueIds: ['a2', 'a1'],
      };
      const next = studioReducer(state, { type: 'REMOVE_ASSET', id: 'a1' });
      expect(next.postQueueIds).toEqual(['a2']);
    });

    it('clears and sets the queue', () => {
      let state = studioReducer(initialState, {
        type: 'POST_QUEUE_SET',
        ids: ['x', 'y', 'x', 'z'],
      });
      expect(state.postQueueIds).toEqual(['x', 'y', 'z']);
      state = studioReducer(state, { type: 'POST_QUEUE_CLEAR' });
      expect(state.postQueueIds).toEqual([]);
    });
  });
});
