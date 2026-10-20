import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../components/AIImageStudio/useStudioReducer';
import {
  deserializeStudioState,
  serializeStudioState,
  SESSION_STORAGE_KEY,
} from '../../components/AIImageStudio/studioStatePersistence';
import {
  CURRENT_SESSION_DISK_ID,
  isAutosaveProjectId,
  preferStudioSession,
  readSessionFromLocalStorage,
  resolveResumeSession,
  scoreStudioSession,
  writeSessionToLocalStorage,
} from '../../components/AIImageStudio/studioSessionResume';
import { resetDiskAvailabilityCache } from '../../components/AIImageStudio/studioProjectService';
import type { StudioState } from '../../components/AIImageStudio/types';

function makeState(overrides: Partial<StudioState> = {}): StudioState {
  return {
    ...initialState,
    gallerySelectionIds: new Set(),
    roleAssignments: new Map(),
    assets: [
      {
        id: 'a1',
        name: 'Hero',
        description: 'Packshot',
        base64: 'YWJj',
        mimeType: 'image/png',
        width: 1,
        height: 1,
        source: 'upload',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    ],
    prompt: 'Soft daylight',
    brandUrlInput: 'https://kageha.ca',
    ...overrides,
  };
}

describe('studioSessionResume', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDiskAvailabilityCache();
    vi.unstubAllGlobals();
  });

  it('scores richer sessions higher', () => {
    const thin = makeState({ assets: [], prompt: '', brandUrlInput: '' });
    const rich = makeState({
      brandKnowledge: {
        id: 'b1',
        sourceUrls: ['https://kageha.ca'],
        sources: [],
        brandName: { value: 'Kageha', status: 'verified', confidence: 1, sourceIds: [] },
        fonts: [],
        colors: [],
        logoRules: [],
        visualPrinciples: [],
        toneAttributes: [],
        approvedLanguage: [],
        prohibitedLanguage: [],
        imageStyle: { lighting: [], composition: [], backgrounds: [], textures: [] },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    });
    expect(scoreStudioSession(rich)).toBeGreaterThan(scoreStudioSession(thin));
  });

  it('prefers the session with more restored work', () => {
    const local = makeState({ assets: [], prompt: 'x' });
    const disk = makeState({ prompt: 'disk prompt' });
    expect(preferStudioSession(local, disk).prompt).toBe('disk prompt');
  });

  it('round-trips strategist/production fields through serialize', () => {
    const state = makeState({
      strategistBrief: {
        id: 'sb1',
        campaignGoal: 'Launch',
        executionMode: 'original',
        summary: 'Calm ritual launch',
        brandFit: 'Premium tea',
        productFit: 'Matcha',
        trendAngles: [],
        preservationPriorities: [],
        creativeTerritories: [],
        constraints: [],
        openQuestions: [],
        sourceInsightIds: [],
        createdAt: '2026-01-01T00:00:00.000Z',
      },
      isPromptEnriched: true,
      productTruthStale: true,
    });
    const restored = deserializeStudioState(serializeStudioState(state, { maxAssets: null }));
    expect(restored?.strategistBrief?.campaignGoal).toBe('Launch');
    expect(restored?.isPromptEnriched).toBe(true);
    expect(restored?.productTruthStale).toBe(true);
    expect(restored?.brandUrlInput).toBe('https://kageha.ca');
  });

  it('round-trips carousel metadata without rewriting legacy variation metadata', () => {
    const state = makeState({
      assets: [
        {
          ...makeState().assets[0],
          id: 'slide-1',
          carouselSetId: 'carousel-1',
          carouselSlideIndex: 1,
          carouselSlideTitle: 'Hook',
        },
        {
          ...makeState().assets[0],
          id: 'legacy-v1',
          variationSetId: 'legacy-set',
          variationIndex: 1,
        },
      ],
      postQueueIds: ['legacy-v1'],
    });

    const restored = deserializeStudioState(serializeStudioState(state, { maxAssets: null }));

    expect(restored?.assets[0]).toMatchObject({
      carouselSetId: 'carousel-1',
      carouselSlideIndex: 1,
      carouselSlideTitle: 'Hook',
    });
    expect(restored?.assets[1]).toMatchObject({
      variationSetId: 'legacy-set',
      variationIndex: 1,
    });
    expect(restored?.assets[1].carouselSetId).toBeUndefined();
    expect(restored?.postQueueIds).toEqual(['legacy-v1']);
  });

  it('flushes session to localStorage synchronously', () => {
    const ok = writeSessionToLocalStorage(makeState({ prompt: 'flushed' }));
    expect(ok).toBe(true);
    expect(localStorage.getItem(SESSION_STORAGE_KEY)).toContain('flushed');
    expect(readSessionFromLocalStorage()?.prompt).toBe('flushed');
  });

  it('resolveResumeSession upgrades from disk when richer', async () => {
    const diskState = makeState({
      prompt: 'from disk',
      assets: [
        {
          id: 'a1',
          name: 'Hero',
          description: '',
          base64: 'YWJj',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          source: 'upload',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
        {
          id: 'a2',
          name: 'Alt',
          description: '',
          base64: 'YWJj',
          mimeType: 'image/png',
          width: 1,
          height: 1,
          source: 'generated',
          createdAt: '2026-01-01T00:00:00.000Z',
        },
      ],
    });

    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        if (url.includes('/api/studio-project/list')) {
          return { ok: true, json: async () => ({ projects: [], disk: true }) };
        }
        if (url.includes('/api/studio-project/load')) {
          return {
            ok: true,
            json: async () => ({
              project: {
                id: CURRENT_SESSION_DISK_ID,
                name: 'Current session (autosave)',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                assetCount: 2,
                state: serializeStudioState(diskState, { maxAssets: null }),
              },
            }),
          };
        }
        return { ok: false, status: 404 };
      }),
    );
    resetDiskAvailabilityCache();

    const local = makeState({ assets: [], prompt: '' });
    const resumed = await resolveResumeSession(local);
    expect(resumed.prompt).toBe('from disk');
    expect(resumed.assets).toHaveLength(2);
  });

  it('hides autosave id from projects UI', () => {
    expect(isAutosaveProjectId(CURRENT_SESSION_DISK_ID)).toBe(true);
    expect(isAutosaveProjectId('other')).toBe(false);
  });
});
