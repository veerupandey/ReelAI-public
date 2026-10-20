import { beforeEach, describe, expect, it, vi } from 'vitest';
import { initialState } from '../../components/AIImageStudio/useStudioReducer';
import {
  ACTIVE_PROJECT_ID_KEY,
  buildStudioProjectRecord,
  deleteStudioProject,
  deleteStudioProjectAsync,
  exportProjectBundleFromRecord,
  importProjectBundleAsync,
  isDiskProjectsAvailable,
  listStudioProjects,
  listStudioProjectsAsync,
  loadStudioProject,
  loadStudioProjectAsync,
  PROJECTS_STORAGE_KEY,
  resetDiskAvailabilityCache,
  saveStudioProject,
  saveStudioProjectAsync,
  serializeStudioState,
  deserializeStudioState,
} from '../../components/AIImageStudio/studioProjectService';
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
    prompt: 'Soft daylight ritual',
    brandUrlInput: 'https://kageha.ca',
    ...overrides,
  };
}

describe('studioProjectService', () => {
  beforeEach(() => {
    localStorage.clear();
    resetDiskAvailabilityCache();
    vi.unstubAllGlobals();
  });

  it('round-trips serialize/deserialize Sets and Maps', () => {
    const state = makeState({
      gallerySelectionIds: new Set(['a1']),
      roleAssignments: new Map([['a1', { role: 'product' }]]),
      isGenerating: true,
    });
    const restored = deserializeStudioState(serializeStudioState(state));
    expect(restored).not.toBeNull();
    expect(restored!.gallerySelectionIds.has('a1')).toBe(true);
    expect(restored!.roleAssignments.get('a1')?.role).toBe('product');
    expect(restored!.isGenerating).toBe(false);
    expect(restored!.prompt).toBe('Soft daylight ritual');
  });

  it('promotes legacy selectedIds into gallerySelectionIds when gallery is empty', () => {
    const restored = deserializeStudioState({
      ...serializeStudioState(makeState()),
      selectedIds: ['a1'],
      gallerySelectionIds: [],
    });
    expect(restored).not.toBeNull();
    expect(restored!.gallerySelectionIds.has('a1')).toBe(true);
    expect(restored!.gallerySelectionIds.has('a1')).toBe(true);
  });

  it('saves, lists, loads, and deletes named projects', () => {
    const saved = saveStudioProject('Matcha Q3', makeState());
    expect(saved.name).toBe('Matcha Q3');
    expect(listStudioProjects()).toHaveLength(1);
    expect(localStorage.getItem(ACTIVE_PROJECT_ID_KEY)).toBe(saved.id);

    const loaded = loadStudioProject(saved.id);
    expect(loaded?.assets[0].id).toBe('a1');
    expect(loaded?.prompt).toBe('Soft daylight ritual');

    deleteStudioProject(saved.id);
    expect(listStudioProjects()).toHaveLength(0);
    expect(localStorage.getItem(PROJECTS_STORAGE_KEY)).toContain('"projects":[]');
  });

  it('upserts the same project id on save', () => {
    const first = saveStudioProject('Draft', makeState({ prompt: 'one' }));
    const second = saveStudioProject('Draft v2', makeState({ prompt: 'two' }), { id: first.id });
    expect(second.id).toBe(first.id);
    expect(listStudioProjects()).toHaveLength(1);
    expect(loadStudioProject(first.id)?.prompt).toBe('two');
  });

  it('buildStudioProjectRecord includes brandUrl in serialized state', () => {
    const record = buildStudioProjectRecord('Brand test', makeState());
    const restored = deserializeStudioState(record.state);
    expect(restored?.brandUrlInput).toBe('https://kageha.ca');
    expect(record.assetCount).toBe(1);
  });

  it('exportProjectBundleFromRecord round-trips via import when disk is off', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 404, text: async () => 'no' })),
    );
    resetDiskAvailabilityCache();
    const record = buildStudioProjectRecord('Export me', makeState({ prompt: 'exported' }));
    const { blob, filename } = exportProjectBundleFromRecord(record);
    expect(filename).toContain('Export_me');
    expect(blob.type).toBe('application/json');
    const raw = {
      schemaVersion: 1 as const,
      kind: 'reelai-studio-project' as const,
      exportedAt: new Date().toISOString(),
      project: record,
    };
    const restored = await importProjectBundleAsync(raw);
    expect(restored?.prompt).toBe('exported');
    expect(listStudioProjects().some((p) => p.name === 'Export me')).toBe(true);
  });

  describe('disk API', () => {
    it('detects disk availability from list endpoint', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async (url: string) => {
          if (String(url).includes('/api/studio-project/list')) {
            return {
              ok: true,
              json: async () => ({ projects: [], disk: true }),
            };
          }
          return { ok: false, status: 404 };
        }),
      );
      expect(await isDiskProjectsAvailable()).toBe(true);
      expect(await isDiskProjectsAvailable()).toBe(true); // cached
    });

    it('saves, lists, loads, and deletes via disk API', async () => {
      const store = new Map<string, ReturnType<typeof buildStudioProjectRecord>>();

      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
          const url = String(input);
          if (url.includes('/api/studio-project/list') && (!init || init.method === undefined || init.method === 'GET')) {
            return {
              ok: true,
              json: async () => ({
                projects: [...store.values()].map(({ state: _s, ...summary }) => summary),
                disk: true,
              }),
            };
          }
          if (url.includes('/api/studio-project/save') && init?.method === 'POST') {
            const body = JSON.parse(String(init.body)) as {
              project: ReturnType<typeof buildStudioProjectRecord>;
            };
            const project = { ...body.project, updatedAt: new Date().toISOString() };
            store.set(project.id, project);
            return { ok: true, json: async () => ({ saved: true, project }) };
          }
          if (url.includes('/api/studio-project/load')) {
            const id = new URL(url, 'http://localhost').searchParams.get('id') || '';
            const project = store.get(id);
            if (!project) return { ok: false, status: 404, json: async () => ({ error: 'missing' }) };
            return { ok: true, json: async () => ({ project }) };
          }
          if (url.includes('/api/studio-project') && init?.method === 'DELETE') {
            const id = new URL(url, 'http://localhost').searchParams.get('id') || '';
            store.delete(id);
            return { ok: true, json: async () => ({ deleted: true, id }) };
          }
          return { ok: false, status: 404 };
        }),
      );

      resetDiskAvailabilityCache();
      const saved = await saveStudioProjectAsync('Disk Matcha', makeState({ prompt: 'on disk' }));
      expect(saved.name).toBe('Disk Matcha');
      expect(localStorage.getItem(ACTIVE_PROJECT_ID_KEY)).toBe(saved.id);

      const listed = await listStudioProjectsAsync();
      expect(listed).toHaveLength(1);
      expect(listed[0].name).toBe('Disk Matcha');

      const loaded = await loadStudioProjectAsync(saved.id);
      expect(loaded?.prompt).toBe('on disk');
      expect(loaded?.brandUrlInput).toBe('https://kageha.ca');

      await deleteStudioProjectAsync(saved.id);
      expect(await listStudioProjectsAsync()).toHaveLength(0);
    });

    it('falls back to localStorage when disk API is unavailable', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(async () => {
          throw new Error('network');
        }),
      );
      resetDiskAvailabilityCache();
      expect(await isDiskProjectsAvailable()).toBe(false);

      const saved = await saveStudioProjectAsync('Browser fallback', makeState());
      expect(listStudioProjects()).toHaveLength(1);
      expect((await loadStudioProjectAsync(saved.id))?.assets[0].id).toBe('a1');
    });
  });
});
