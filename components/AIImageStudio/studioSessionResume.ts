/**
 * Resume helpers for Image Studio after refresh / tab discard / laptop sleep.
 * Combines localStorage (fast, sync) with disk autosave (large sessions).
 */

import type { StudioState } from './types';
import {
  deserializeStudioState,
  serializeStudioState,
  SESSION_STORAGE_KEY,
} from './studioStatePersistence';
import {
  buildStudioProjectRecord,
  fetchStudioProjectRecord,
  isDiskProjectsAvailable,
} from './studioProjectService';

/** Fixed on-disk autosave slot — overwritten as you work. */
export const CURRENT_SESSION_DISK_ID = 'current-session';
export const CURRENT_SESSION_DISK_NAME = 'Current session (autosave)';

/** Rough richness score for choosing between local vs disk snapshots. */
export function scoreStudioSession(state: StudioState): number {
  return (
    state.assets.length * 10 +
    state.composerReferences.length * 2 +
    state.conceptCandidates.length * 3 +
    (state.brandKnowledge ? 8 : 0) +
    (state.productTruth ? 8 : 0) +
    (state.strategistBrief ? 5 : 0) +
    (state.productionBrief ? 4 : 0) +
    (state.trendResearch ? 4 : 0) +
    (state.socialPostDraft ? 3 : 0) +
    (state.captionPack ? 2 : 0) +
    (state.prompt.trim() ? 2 : 0) +
    (state.brandUrlInput.trim() ? 1 : 0) +
    state.postQueueIds.length
  );
}

/** Prefer the session that still has the work (images + planning context). */
export function preferStudioSession(a: StudioState, b: StudioState): StudioState {
  const scoreA = scoreStudioSession(a);
  const scoreB = scoreStudioSession(b);
  if (scoreA !== scoreB) return scoreA > scoreB ? a : b;
  // Tie-break: more assets wins, else keep `a` (usually the already-hydrated local).
  if (a.assets.length !== b.assets.length) {
    return a.assets.length > b.assets.length ? a : b;
  }
  return a;
}

export function readSessionFromLocalStorage(): StudioState | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    return deserializeStudioState(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** Sync write — used on visibility hide / pagehide so refresh does not lose the last edit. */
export function writeSessionToLocalStorage(state: StudioState): boolean {
  if (typeof window === 'undefined') return false;
  try {
    localStorage.setItem(
      SESSION_STORAGE_KEY,
      JSON.stringify(serializeStudioState(state, { maxAssets: 50 })),
    );
    return true;
  } catch (e) {
    if (!(e instanceof Error) || e.name !== 'QuotaExceededError') return false;
    try {
      const trimmed = { ...state, assets: state.assets.slice(-10) };
      localStorage.setItem(
        SESSION_STORAGE_KEY,
        JSON.stringify(serializeStudioState(trimmed, { maxAssets: 10 })),
      );
      return true;
    } catch {
      return false;
    }
  }
}

export async function saveCurrentSessionToDisk(state: StudioState): Promise<boolean> {
  if (!(await isDiskProjectsAvailable())) return false;
  try {
    const record = buildStudioProjectRecord(CURRENT_SESSION_DISK_NAME, state, {
      id: CURRENT_SESSION_DISK_ID,
    });
    const res = await fetch('/api/studio-project/save', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        id: CURRENT_SESSION_DISK_ID,
        name: CURRENT_SESSION_DISK_NAME,
        project: {
          ...record,
          // Full asset set for disk (no localStorage trim)
          state: serializeStudioState(state, { maxAssets: null }),
          assetCount: state.assets.length,
        },
      }),
      keepalive: true,
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function loadCurrentSessionFromDisk(): Promise<StudioState | null> {
  if (!(await isDiskProjectsAvailable())) return null;
  try {
    const record = await fetchStudioProjectRecord(CURRENT_SESSION_DISK_ID);
    if (!record?.state) return null;
    return deserializeStudioState(record.state);
  } catch {
    return null;
  }
}

/**
 * Resolve the best session to resume after mount.
 * Starts from already-loaded local state, upgrades from disk when disk is richer.
 */
export async function resolveResumeSession(local: StudioState): Promise<StudioState> {
  const disk = await loadCurrentSessionFromDisk();
  if (!disk) return local;
  return preferStudioSession(local, disk);
}

/** Hide autosave slot from the Projects list UI. */
export function isAutosaveProjectId(id: string): boolean {
  return id === CURRENT_SESSION_DISK_ID;
}
