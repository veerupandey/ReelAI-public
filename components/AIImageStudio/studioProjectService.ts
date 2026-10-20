/**
 * Named Image Studio project persistence.
 * Prefers on-disk folders via the Vite `/api/studio-project/*` API (dev).
 * Falls back to localStorage when the disk API is unavailable.
 * Session autosave remains separate (`ai-image-studio-session-v1`).
 */

import type { StudioState } from './types';
import {
  deserializeStudioState,
  serializeStudioState,
  type SerializedStudioState,
} from './studioStatePersistence';
import { buildExportZipEntries } from './exportPackService';
import { buildZipBlob, downloadBlob } from './zipStore';

export {
  deserializeStudioState,
  serializeStudioState,
  SESSION_STORAGE_KEY,
  type SerializedStudioState,
} from './studioStatePersistence';

export const PROJECTS_STORAGE_KEY = 'ai-image-studio-projects-v1';
export const ACTIVE_PROJECT_ID_KEY = 'ai-image-studio-active-project-id-v1';
export const EXPORT_COMPLIANCE_MODE_KEY = 'ai-image-studio-export-compliance-mode-v1';

const MAX_PROJECTS = 10;

export interface StudioProjectSummary {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  assetCount: number;
  brandName?: string;
}

export interface StudioProjectRecord extends StudioProjectSummary {
  state: SerializedStudioState;
}

interface StudioProjectIndex {
  projects: StudioProjectRecord[];
}

/** @internal test helper — reset disk availability probe */
let diskAvailableCache: boolean | null = null;

export function resetDiskAvailabilityCache(): void {
  diskAvailableCache = null;
}

export async function isDiskProjectsAvailable(): Promise<boolean> {
  if (diskAvailableCache !== null) return diskAvailableCache;
  try {
    const res = await fetch('/api/studio-project/list');
    diskAvailableCache = res.ok;
  } catch {
    diskAvailableCache = false;
  }
  return diskAvailableCache;
}

function readIndex(): StudioProjectIndex {
  if (typeof localStorage === 'undefined') return { projects: [] };
  try {
    const raw = localStorage.getItem(PROJECTS_STORAGE_KEY);
    if (!raw) return { projects: [] };
    const parsed = JSON.parse(raw) as StudioProjectIndex;
    return { projects: Array.isArray(parsed.projects) ? parsed.projects : [] };
  } catch {
    return { projects: [] };
  }
}

function writeIndex(index: StudioProjectIndex): void {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(index));
  } catch (e) {
    if (e instanceof Error && e.name === 'QuotaExceededError') {
      const trimmed = { projects: index.projects.slice(0, 3) };
      localStorage.setItem(PROJECTS_STORAGE_KEY, JSON.stringify(trimmed));
      return;
    }
    throw e;
  }
}

export function buildStudioProjectRecord(
  name: string,
  state: StudioState,
  opts?: { id?: string; createdAt?: string },
): StudioProjectRecord {
  const now = new Date().toISOString();
  return {
    id: opts?.id || crypto.randomUUID(),
    name: name.trim() || 'Untitled project',
    createdAt: opts?.createdAt || now,
    updatedAt: now,
    assetCount: state.assets.length,
    brandName: state.brandKnowledge?.brandName.value,
    state: serializeStudioState(state),
  };
}

/** Sync localStorage list (fallback / tests). */
export function listStudioProjects(): StudioProjectSummary[] {
  return readIndex()
    .projects.map(({ state: _state, ...summary }) => summary)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

/** Sync localStorage save (fallback / tests). */
export function saveStudioProject(
  name: string,
  state: StudioState,
  opts?: { id?: string },
): StudioProjectRecord {
  const index = readIndex();
  const existing = opts?.id ? index.projects.find((p) => p.id === opts.id) : undefined;
  const record = buildStudioProjectRecord(name, state, {
    id: existing?.id || opts?.id,
    createdAt: existing?.createdAt,
  });

  const without = index.projects.filter((p) => p.id !== record.id);
  const next = { projects: [record, ...without].slice(0, MAX_PROJECTS) };
  writeIndex(next);
  setActiveStudioProjectId(record.id);
  return record;
}

/** Sync localStorage load (fallback / tests). */
export function loadStudioProject(id: string): StudioState | null {
  const record = readIndex().projects.find((p) => p.id === id);
  if (!record) return null;
  const restored = deserializeStudioState(record.state);
  if (restored) setActiveStudioProjectId(id);
  return restored;
}

/** Sync localStorage delete (fallback / tests). */
export function deleteStudioProject(id: string): void {
  const index = readIndex();
  writeIndex({ projects: index.projects.filter((p) => p.id !== id) });
  if (getActiveStudioProjectId() === id) setActiveStudioProjectId(null);
}

export function getActiveStudioProjectId(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(ACTIVE_PROJECT_ID_KEY);
}

export function setActiveStudioProjectId(id: string | null): void {
  if (typeof localStorage === 'undefined') return;
  if (!id) localStorage.removeItem(ACTIVE_PROJECT_ID_KEY);
  else localStorage.setItem(ACTIVE_PROJECT_ID_KEY, id);
}

async function saveStudioProjectToDisk(record: StudioProjectRecord): Promise<StudioProjectRecord> {
  const res = await fetch('/api/studio-project/save', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: record.id, name: record.name, project: record }),
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(err || `Disk save failed (${res.status})`);
  }
  const data = (await res.json()) as { project: StudioProjectRecord };
  return data.project;
}

export async function listStudioProjectsAsync(): Promise<StudioProjectSummary[]> {
  if (await isDiskProjectsAvailable()) {
    const res = await fetch('/api/studio-project/list');
    if (!res.ok) throw new Error('Failed to list disk projects');
    const data = (await res.json()) as { projects: StudioProjectSummary[] };
    return Array.isArray(data.projects) ? data.projects : [];
  }
  return listStudioProjects();
}

export async function saveStudioProjectAsync(
  name: string,
  state: StudioState,
  opts?: { id?: string },
): Promise<StudioProjectRecord> {
  if (await isDiskProjectsAvailable()) {
    let createdAt: string | undefined;
    if (opts?.id) {
      try {
        const existing = await fetchStudioProjectRecord(opts.id);
        createdAt = existing?.createdAt;
      } catch {
        // new id
      }
    }
    const record = buildStudioProjectRecord(name, state, {
      id: opts?.id,
      createdAt,
    });
    const saved = await saveStudioProjectToDisk(record);
    setActiveStudioProjectId(saved.id);
    return saved;
  }
  return saveStudioProject(name, state, opts);
}

export async function fetchStudioProjectRecord(id: string): Promise<StudioProjectRecord | null> {
  if (await isDiskProjectsAvailable()) {
    const res = await fetch(`/api/studio-project/load?id=${encodeURIComponent(id)}`);
    if (res.status === 404) return null;
    if (!res.ok) throw new Error('Failed to load disk project');
    const data = (await res.json()) as { project: StudioProjectRecord };
    return data.project ?? null;
  }
  return readIndex().projects.find((p) => p.id === id) ?? null;
}

export async function loadStudioProjectAsync(id: string): Promise<StudioState | null> {
  const record = await fetchStudioProjectRecord(id);
  if (!record) return null;
  const restored = deserializeStudioState(record.state);
  if (restored) setActiveStudioProjectId(id);
  return restored;
}

export async function deleteStudioProjectAsync(id: string): Promise<void> {
  if (await isDiskProjectsAvailable()) {
    const res = await fetch(`/api/studio-project?id=${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
    if (!res.ok) throw new Error('Failed to delete disk project');
    if (getActiveStudioProjectId() === id) setActiveStudioProjectId(null);
    return;
  }
  deleteStudioProject(id);
}

export interface ProjectBundleV1 {
  schemaVersion: 1;
  kind: 'reelai-studio-project';
  exportedAt: string;
  project: StudioProjectRecord;
}

export function exportProjectBundleFromRecord(
  record: StudioProjectRecord,
): { filename: string; blob: Blob } {
  const bundle: ProjectBundleV1 = {
    schemaVersion: 1,
    kind: 'reelai-studio-project',
    exportedAt: new Date().toISOString(),
    project: record,
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], {
    type: 'application/json',
  });
  const filename = `${(record.name || 'project')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .slice(0, 40)}-studio-project.json`;
  return { filename, blob };
}

/** Download a shareable project JSON bundle (local-first; no cloud URL). */
export function exportProjectBundle(
  projectId: string,
): { filename: string; blob: Blob } | null {
  const record = readIndex().projects.find((p) => p.id === projectId);
  if (!record) return null;
  return exportProjectBundleFromRecord(record);
}

export function downloadProjectBundleFromRecord(record: StudioProjectRecord): boolean {
  const packed = exportProjectBundleFromRecord(record);
  const url = URL.createObjectURL(packed.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = packed.filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export function downloadProjectBundle(projectId: string): boolean {
  const packed = exportProjectBundle(projectId);
  if (!packed) return false;
  const url = URL.createObjectURL(packed.blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = packed.filename;
  a.click();
  URL.revokeObjectURL(url);
  return true;
}

export async function downloadProjectBundleAsync(projectId: string): Promise<boolean> {
  const record = await fetchStudioProjectRecord(projectId);
  if (!record) return false;
  return downloadProjectBundleFromRecord(record);
}

export function importProjectBundle(raw: unknown): StudioState | null {
  const parsed = raw as ProjectBundleV1;
  if (!parsed || parsed.kind !== 'reelai-studio-project' || !parsed.project?.state) {
    return null;
  }
  const restored = deserializeStudioState(parsed.project.state);
  if (!restored) return null;
  saveStudioProject(parsed.project.name || 'Imported project', restored, {
    id: parsed.project.id,
  });
  return restored;
}

export async function importProjectBundleAsync(raw: unknown): Promise<StudioState | null> {
  const parsed = raw as ProjectBundleV1;
  if (!parsed || parsed.kind !== 'reelai-studio-project' || !parsed.project?.state) {
    return null;
  }
  const restored = deserializeStudioState(parsed.project.state);
  if (!restored) return null;
  await saveStudioProjectAsync(parsed.project.name || 'Imported project', restored, {
    id: parsed.project.id,
  });
  return restored;
}

/** Client review pack zip for handoff without requiring cloud share links. */
export function downloadReviewBundle(
  state: StudioState,
  opts?: { redactPrompts?: boolean; brandName?: string },
): { fileCount: number } {
  const assets = opts?.redactPrompts
    ? state.assets.map((a) => ({ ...a, generationPrompt: undefined }))
    : state.assets;
  const entries = buildExportZipEntries({
    assets,
    socialPostDraft: state.socialPostDraft,
    brandName: opts?.brandName || state.brandKnowledge?.brandName.value,
    brandKnowledge: state.brandKnowledge,
    productTruth: state.productTruth,
    clientPack: true,
  });
  const brandSlug = (opts?.brandName || state.brandKnowledge?.brandName.value || 'studio')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .toLowerCase()
    .slice(0, 40);
  const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  downloadBlob(buildZipBlob(entries), `${brandSlug}-review-pack-${stamp}.zip`);
  return { fileCount: entries.length };
}
