/**
 * StudioProjectMenu — save / open named Image Studio projects.
 * Prefers on-disk folders when the Vite disk API is available.
 */

import React, { useCallback, useEffect, useState } from 'react';
import type { StudioState } from './types';
import { initialState } from './useStudioReducer';
import {
  deleteStudioProjectAsync,
  downloadProjectBundleAsync,
  downloadReviewBundle,
  getActiveStudioProjectId,
  importProjectBundleAsync,
  isDiskProjectsAvailable,
  listStudioProjectsAsync,
  loadStudioProjectAsync,
  saveStudioProjectAsync,
  setActiveStudioProjectId,
  serializeStudioState,
  deserializeStudioState,
  type StudioProjectSummary,
} from './studioProjectService';
import { isAutosaveProjectId } from './studioSessionResume';

export interface StudioProjectMenuProps {
  state: StudioState;
  onReplaceState: (next: StudioState) => void;
  onToast: (message: string, type: 'error' | 'success') => void;
}

const StudioProjectMenu: React.FC<StudioProjectMenuProps> = ({
  state,
  onReplaceState,
  onToast,
}) => {
  const [open, setOpen] = useState(false);
  const [projects, setProjects] = useState<StudioProjectSummary[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [activeName, setActiveName] = useState('Untitled session');
  const [diskAvailable, setDiskAvailable] = useState(false);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    const [list, onDisk] = await Promise.all([
      listStudioProjectsAsync().catch(() => [] as StudioProjectSummary[]),
      isDiskProjectsAvailable(),
    ]);
    setProjects(list.filter((p) => !isAutosaveProjectId(p.id)));
    setDiskAvailable(onDisk);
    const id = getActiveStudioProjectId();
    setActiveId(id);
    const match = list.find((p) => p.id === id);
    setActiveName(match?.name || 'Untitled session');
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh, open]);

  const handleSave = useCallback(async () => {
    const name =
      activeId && projects.find((p) => p.id === activeId)?.name
        ? projects.find((p) => p.id === activeId)!.name
        : window.prompt('Project name', activeName === 'Untitled session' ? 'My project' : activeName);
    if (!name) return;
    setBusy(true);
    try {
      const record = await saveStudioProjectAsync(name, state, activeId ? { id: activeId } : undefined);
      await refresh();
      onToast(
        diskAvailable ? `Saved “${record.name}” on disk` : `Saved “${record.name}”`,
        'success',
      );
      setOpen(false);
    } catch {
      onToast('Could not save project', 'error');
    } finally {
      setBusy(false);
    }
  }, [activeId, activeName, projects, state, refresh, onToast, diskAvailable]);

  const handleSaveAs = useCallback(async () => {
    const name = window.prompt('Save project as', `${activeName} copy`);
    if (!name) return;
    setBusy(true);
    try {
      const record = await saveStudioProjectAsync(name, state);
      await refresh();
      onToast(
        diskAvailable ? `Saved “${record.name}” on disk` : `Saved “${record.name}”`,
        'success',
      );
      setOpen(false);
    } catch {
      onToast('Could not save project', 'error');
    } finally {
      setBusy(false);
    }
  }, [activeName, state, refresh, onToast, diskAvailable]);

  const handleOpen = useCallback(
    async (id: string) => {
      setBusy(true);
      try {
        const restored = await loadStudioProjectAsync(id);
        if (!restored) {
          onToast('Could not load project', 'error');
          return;
        }
        onReplaceState(restored);
        await refresh();
        onToast('Project loaded', 'success');
        setOpen(false);
      } catch {
        onToast('Could not load project', 'error');
      } finally {
        setBusy(false);
      }
    },
    [onReplaceState, refresh, onToast],
  );

  const handleNew = useCallback(async () => {
    if (state.assets.length > 0 && !window.confirm('Start a new project? Unsaved changes may be lost.')) {
      return;
    }
    setActiveStudioProjectId(null);
    const blank = deserializeStudioState(serializeStudioState(initialState)) ?? initialState;
    onReplaceState(blank);
    await refresh();
    onToast('New project started', 'success');
    setOpen(false);
  }, [state.assets.length, onReplaceState, refresh, onToast]);

  const handleDelete = useCallback(
    async (id: string, name: string) => {
      if (!window.confirm(`Delete project “${name}”?`)) return;
      setBusy(true);
      try {
        await deleteStudioProjectAsync(id);
        await refresh();
        onToast(`Deleted “${name}”`, 'success');
      } catch {
        onToast('Could not delete project', 'error');
      } finally {
        setBusy(false);
      }
    },
    [refresh, onToast],
  );

  const handleExport = useCallback(async () => {
    setBusy(true);
    try {
      let id = activeId;
      if (!id) {
        const record = await saveStudioProjectAsync(
          activeName === 'Untitled session' ? 'My project' : activeName,
          state,
        );
        id = record.id;
        await refresh();
      }
      if (!(await downloadProjectBundleAsync(id))) {
        onToast('Could not export project', 'error');
        return;
      }
      onToast('Project bundle downloaded', 'success');
    } catch {
      onToast('Could not export project', 'error');
    } finally {
      setBusy(false);
    }
  }, [activeId, activeName, state, refresh, onToast]);

  const handleImportFile = useCallback(
    async (file: File) => {
      setBusy(true);
      try {
        const text = await file.text();
        const restored = await importProjectBundleAsync(JSON.parse(text));
        if (!restored) {
          onToast('Invalid project bundle', 'error');
          return;
        }
        onReplaceState(restored);
        await refresh();
        onToast('Project imported', 'success');
        setOpen(false);
      } catch {
        onToast('Could not import project', 'error');
      } finally {
        setBusy(false);
      }
    },
    [onReplaceState, refresh, onToast],
  );

  const handleReviewPack = useCallback(() => {
    if (state.assets.length === 0) {
      onToast('Add images before creating a review pack', 'error');
      return;
    }
    downloadReviewBundle(state, { redactPrompts: true });
    onToast('Client review pack downloaded', 'success');
  }, [state, onToast]);

  return (
    <div className="relative" data-testid="studio-project-menu">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="rounded-lg border border-dark-border bg-dark-card px-3 py-2 text-xs font-medium text-gray-200 hover:text-white"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        Projects · {activeName.length > 18 ? `${activeName.slice(0, 18)}…` : activeName}
      </button>

      {open && (
        <div
          className="absolute left-0 top-full z-40 mt-1 w-72 rounded-xl border border-dark-border bg-dark-card p-2 shadow-xl"
          role="menu"
        >
          <p
            className={`mb-2 px-1 text-[10px] ${
              diskAvailable ? 'text-emerald-400/90' : 'text-amber-300/80'
            }`}
            data-testid="studio-project-storage-hint"
          >
            {diskAvailable
              ? 'Saved on disk (studio-projects/)'
              : 'Browser only — start npm run dev for disk save'}
          </p>
          <div className="flex flex-wrap gap-1 mb-2">
            <button
              type="button"
              onClick={() => void handleSave()}
              disabled={busy}
              className="flex-1 rounded-lg bg-purple-600 px-2 py-1.5 text-[11px] font-semibold text-white disabled:opacity-50"
            >
              Save
            </button>
            <button
              type="button"
              onClick={() => void handleSaveAs()}
              disabled={busy}
              className="flex-1 rounded-lg border border-dark-border px-2 py-1.5 text-[11px] text-gray-200 disabled:opacity-50"
            >
              Save as
            </button>
            <button
              type="button"
              onClick={() => void handleNew()}
              disabled={busy}
              className="flex-1 rounded-lg border border-dark-border px-2 py-1.5 text-[11px] text-gray-200 disabled:opacity-50"
            >
              New
            </button>
          </div>
          <div className="flex flex-wrap gap-1 mb-2">
            <button
              type="button"
              onClick={() => void handleExport()}
              disabled={busy}
              className="flex-1 rounded-lg border border-emerald-500/30 px-2 py-1.5 text-[11px] text-emerald-200 disabled:opacity-50"
            >
              Export
            </button>
            <label className="flex-1 rounded-lg border border-dark-border px-2 py-1.5 text-[11px] text-gray-200 text-center cursor-pointer">
              Import
              <input
                type="file"
                accept="application/json,.json"
                className="hidden"
                disabled={busy}
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) void handleImportFile(file);
                  e.target.value = '';
                }}
              />
            </label>
            <button
              type="button"
              onClick={handleReviewPack}
              disabled={busy}
              className="flex-1 rounded-lg border border-cyan-500/30 px-2 py-1.5 text-[11px] text-cyan-200 disabled:opacity-50"
            >
              Review pack
            </button>
          </div>

          {projects.length === 0 ? (
            <p className="px-2 py-3 text-[11px] text-gray-500">No saved projects yet.</p>
          ) : (
            <ul className="max-h-56 overflow-y-auto space-y-1">
              {projects.map((project) => (
                <li
                  key={project.id}
                  className={`flex items-center gap-1 rounded-lg px-2 py-1.5 ${
                    project.id === activeId ? 'bg-purple-500/15' : 'hover:bg-white/5'
                  }`}
                >
                  <button
                    type="button"
                    onClick={() => void handleOpen(project.id)}
                    disabled={busy}
                    className="min-w-0 flex-1 text-left disabled:opacity-50"
                  >
                    <div className="truncate text-xs text-white font-medium">{project.name}</div>
                    <div className="text-[10px] text-gray-500">
                      {project.assetCount} assets
                      {project.brandName ? ` · ${project.brandName}` : ''}
                    </div>
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(project.id, project.name)}
                    disabled={busy}
                    className="px-1.5 py-1 text-[10px] text-red-300 hover:text-red-200 disabled:opacity-50"
                    aria-label={`Delete ${project.name}`}
                  >
                    Del
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
};

export default StudioProjectMenu;
