import React, { useEffect, useMemo, useRef, useState } from 'react';
import type { SceneReferenceBinding } from '../../types';
import { createExternalSceneReferenceBinding, normalizeSceneReferenceBindings } from '../../utils/sceneReferenceBuilder';
import { getSceneReferenceRoleLabel, getSceneReferenceSourceLabel } from './scriptStudioViewUtils';

export interface SceneReferencePickerOption extends SceneReferenceBinding {
  key: string;
  section: string;
  note?: string;
  current?: boolean;
}

interface SceneReferencePickerModalProps {
  open: boolean;
  mode: 'base_asset' | 'reference_assets';
  sceneLabel: string;
  productTitle?: string;
  candidates: SceneReferencePickerOption[];
  currentBindings: SceneReferenceBinding[];
  currentBaseSelectionKey?: string;
  onClose: () => void;
  onApplyBaseAsset: (binding: SceneReferencePickerOption) => void;
  onSaveReferences: (bindings: SceneReferenceBinding[]) => void;
}

const USER_SELECTABLE_ROLES: Array<SceneReferenceBinding['role']> = [
  'product',
  'person',
  'environment',
  'style_guide',
  'reference',
];

const readFileAsBase64 = (file: File): Promise<{ base64: string; previewUrl: string }> => (
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const [, base64 = ''] = result.split(',');
      resolve({ base64, previewUrl: result });
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  })
);

const SceneReferencePickerModal: React.FC<SceneReferencePickerModalProps> = ({
  open,
  mode,
  sceneLabel,
  productTitle,
  candidates,
  currentBindings,
  currentBaseSelectionKey,
  onClose,
  onApplyBaseAsset,
  onSaveReferences,
}) => {
  const [selectedKey, setSelectedKey] = useState<string>('');
  const [draftBindings, setDraftBindings] = useState<SceneReferenceBinding[]>([]);
  const [refUrl, setRefUrl] = useState('');
  const [isFetchingRef, setIsFetchingRef] = useState(false);
  const [externalError, setExternalError] = useState('');
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setSelectedKey(currentBaseSelectionKey || '');
    setDraftBindings(normalizeSceneReferenceBindings(currentBindings));
    setRefUrl('');
    setExternalError('');
    setIsFetchingRef(false);
  }, [open, currentBindings, currentBaseSelectionKey]);

  const groupedCandidates = useMemo(() => {
    const groups = new Map<string, SceneReferencePickerOption[]>();
    candidates.forEach((candidate) => {
      const section = candidate.section || 'Available';
      const existing = groups.get(section) || [];
      existing.push(candidate);
      groups.set(section, existing);
    });
    return Array.from(groups.entries());
  }, [candidates]);

  const selectedKeys = useMemo(() => new Set(draftBindings.map((binding) => `${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`)), [draftBindings]);

  const toggleReferenceBinding = (candidate: SceneReferencePickerOption) => {
    const key = `${candidate.source}:${candidate.assetId}:${candidate.variantId || ''}:${candidate.sourceSceneId || ''}`;
    setDraftBindings((prev) => {
      const exists = prev.some((binding) => `${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}` === key);
      if (exists) {
        return prev.filter((binding) => `${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}` !== key);
      }
      if (prev.length >= 4) {
        return prev;
      }
      return normalizeSceneReferenceBindings([
        ...prev,
        {
          ...candidate,
          role: candidate.role === 'previous_scene' ? 'reference' : candidate.role,
        },
      ]);
    });
  };

  const updateBindingRole = (bindingKey: string, nextRole: SceneReferenceBinding['role']) => {
    setDraftBindings((prev) => prev.map((binding) => (
      `${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}` === bindingKey
        ? { ...binding, role: nextRole }
        : binding
    )));
  };

  const addExternalBinding = async (binding: SceneReferenceBinding) => {
    setDraftBindings((prev) => {
      if (prev.length >= 4) return prev;
      return normalizeSceneReferenceBindings([...prev, binding]);
    });
  };

  const handleFetchReference = async () => {
    if (!refUrl.trim()) return;
    setIsFetchingRef(true);
    setExternalError('');
    try {
      const response = await fetch(refUrl.trim());
      if (!response.ok) {
        throw new Error(`Fetch failed: ${response.status}`);
      }
      const blob = await response.blob();
      const mimeType = blob.type || 'image/jpeg';
      const filename = refUrl.trim().split('/').filter(Boolean).pop() || 'External reference';
      const { base64, previewUrl } = await readFileAsBase64(new File([blob], filename, { type: mimeType }));
      await addExternalBinding(createExternalSceneReferenceBinding({
        label: filename,
        description: refUrl.trim(),
        base64,
        mimeType,
        previewUrl,
        role: 'reference',
        sourceHint: refUrl.trim(),
      }));
      setRefUrl('');
    } catch (error: any) {
      setExternalError(
        error?.message?.includes('Failed to fetch') || error?.name === 'TypeError'
          ? 'CORS blocked or network error. This image URL may not allow cross-origin fetches.'
          : (error?.message || 'Failed to fetch reference image.'),
      );
    } finally {
      setIsFetchingRef(false);
    }
  };

  const handleExternalFile = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    try {
      const { base64, previewUrl } = await readFileAsBase64(file);
      await addExternalBinding(createExternalSceneReferenceBinding({
        label: file.name,
        description: 'Uploaded reference',
        base64,
        mimeType: file.type || 'image/png',
        previewUrl,
      }));
    } catch (error) {
      console.error('[SceneReferencePickerModal] Failed to read uploaded reference', error);
      setExternalError('Unable to read that file as a reference image.');
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/75 backdrop-blur-sm px-4">
      <div className="w-full max-w-6xl rounded-[28px] border border-white/10 bg-[#090C16] shadow-[0_40px_140px_-60px_rgba(0,0,0,1)] max-h-[88vh] overflow-hidden">
        <div className="flex items-start justify-between gap-4 border-b border-white/10 px-6 py-5">
          <div>
            <p className="text-[10px] uppercase tracking-[0.32em] text-white/40">
              {mode === 'base_asset' ? 'Choose Base Asset' : 'Add References'}
            </p>
            <h3 className="mt-2 text-xl font-bold text-white">
              {sceneLabel}
            </h3>
            <p className="mt-1 text-sm text-white/60">
              {productTitle
                ? `Product lane: ${productTitle}`
                : 'Bind the right source material to this scene.'}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 hover:bg-white/10"
          >
            Close
          </button>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-[1.6fr_1fr] gap-0">
          <div className="border-r border-white/10 p-6 max-h-[72vh] overflow-y-auto custom-scrollbar">
            {groupedCandidates.length === 0 && (
              <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-6 text-sm text-white/50">
                No reusable assets or variants are available yet for this scene.
              </div>
            )}

            {groupedCandidates.map(([section, options]) => (
              <div key={section} className="mb-6">
                <div className="mb-3 flex items-center justify-between">
                  <h4 className="text-xs font-semibold uppercase tracking-[0.25em] text-white/35">{section}</h4>
                  {mode === 'reference_assets' && section === 'Existing External References' && (
                    <span className="text-[10px] text-white/35">Saved on this scene</span>
                  )}
                </div>
                <div className="grid grid-cols-2 xl:grid-cols-3 gap-3">
                  {options.map((candidate) => {
                    const isSelected = mode === 'base_asset'
                      ? selectedKey === candidate.key
                      : selectedKeys.has(`${candidate.source}:${candidate.assetId}:${candidate.variantId || ''}:${candidate.sourceSceneId || ''}`);
                    return (
                      <button
                        key={candidate.key}
                        type="button"
                        onClick={() => {
                          if (mode === 'base_asset') {
                            setSelectedKey(candidate.key);
                          } else {
                            toggleReferenceBinding(candidate);
                          }
                        }}
                        className={`rounded-2xl border p-3 text-left transition ${isSelected ? 'border-insta-purple bg-insta-purple/10' : 'border-white/10 bg-white/5 hover:bg-white/10'}`}
                      >
                        <div className="aspect-[4/5] rounded-xl overflow-hidden bg-black/40 mb-3">
                          {candidate.previewUrl ? (
                            <img src={candidate.previewUrl} alt={candidate.label} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-[10px] text-white/35">No Preview</div>
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 mb-2">
                          <span className="rounded-full border border-white/10 bg-black/30 px-2 py-1 text-[10px] text-white/70">
                            {getSceneReferenceSourceLabel(candidate.source)}
                          </span>
                          {candidate.current && (
                            <span className="rounded-full border border-emerald-500/20 bg-emerald-500/10 px-2 py-1 text-[10px] text-emerald-100/85">
                              Current
                            </span>
                          )}
                        </div>
                        <p className="text-xs font-semibold text-white/85">{candidate.label}</p>
                        {candidate.description && (
                          <p className="mt-1 text-[11px] leading-relaxed text-white/52 line-clamp-3">{candidate.description}</p>
                        )}
                        {candidate.note && (
                          <p className="mt-2 text-[10px] text-white/35">{candidate.note}</p>
                        )}
                      </button>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>

          <div className="p-6 max-h-[72vh] overflow-y-auto custom-scrollbar">
            {mode === 'base_asset' ? (
              <div className="space-y-4">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-white/35">Selection</p>
                  <p className="mt-2 text-sm text-white/70">
                    Pick the exact product shot or variant that should anchor this scene.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    const selected = candidates.find((candidate) => candidate.key === selectedKey);
                    if (!selected) return;
                    onApplyBaseAsset(selected);
                  }}
                  disabled={!selectedKey}
                  className="w-full rounded-2xl bg-gradient-to-r from-insta-mid to-insta-purple px-4 py-3 text-sm font-semibold text-white disabled:opacity-40"
                >
                  Use Selected Base Asset
                </button>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="text-[10px] uppercase tracking-[0.25em] text-white/35">Selected References</p>
                      <p className="mt-2 text-sm text-white/65">Up to 4 extra references. Product anchor and previous-scene continuity are added automatically.</p>
                    </div>
                    <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[11px] text-white/70">
                      {draftBindings.length}/4
                    </span>
                  </div>
                </div>

                <div className="space-y-3">
                  {draftBindings.map((binding) => (
                    <div key={`${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`} className="rounded-2xl border border-white/10 bg-black/30 p-3">
                      <div className="flex items-start gap-3">
                        <div className="h-16 w-16 shrink-0 rounded-xl overflow-hidden bg-black/40">
                          {binding.previewUrl ? (
                            <img src={binding.previewUrl} alt={binding.label} className="h-full w-full object-cover" />
                          ) : (
                            <div className="h-full w-full flex items-center justify-center text-[10px] text-white/30">No Preview</div>
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center justify-between gap-2">
                            <p className="truncate text-sm font-semibold text-white/85">{binding.label}</p>
                            <button
                              type="button"
                              onClick={() => setDraftBindings((prev) => prev.filter((entry) => `${entry.source}:${entry.assetId}:${entry.variantId || ''}:${entry.sourceSceneId || ''}` !== `${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`))}
                              className="text-[10px] text-red-300/80 hover:text-red-200"
                            >
                              Remove
                            </button>
                          </div>
                          <p className="mt-1 text-[11px] text-white/45">{getSceneReferenceSourceLabel(binding.source)}</p>
                          <select
                            value={binding.role}
                            onChange={(event) => updateBindingRole(`${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`, event.target.value as SceneReferenceBinding['role'])}
                            className="mt-2 w-full rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white/75 outline-none"
                          >
                            {USER_SELECTABLE_ROLES.map((role) => (
                              <option key={role} value={role}>{getSceneReferenceRoleLabel(role)}</option>
                            ))}
                          </select>
                        </div>
                      </div>
                    </div>
                  ))}
                  {draftBindings.length === 0 && (
                    <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 p-4 text-sm text-white/45">
                      No extra references selected yet.
                    </div>
                  )}
                </div>

                <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
                  <p className="text-[10px] uppercase tracking-[0.25em] text-white/35">Add External Reference</p>
                  <div className="mt-3 flex gap-2">
                    <input
                      type="text"
                      value={refUrl}
                      onChange={(event) => setRefUrl(event.target.value)}
                      onKeyDown={(event) => event.key === 'Enter' && handleFetchReference()}
                      placeholder="Paste image URL..."
                      className="flex-1 rounded-xl border border-white/10 bg-black/40 px-3 py-2 text-xs text-white outline-none"
                    />
                    <button
                      type="button"
                      onClick={handleFetchReference}
                      disabled={!refUrl.trim() || isFetchingRef || draftBindings.length >= 4}
                      className="rounded-xl border border-white/10 bg-white/10 px-3 py-2 text-xs text-white disabled:opacity-40"
                    >
                      {isFetchingRef ? 'Fetching...' : 'Fetch'}
                    </button>
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      disabled={draftBindings.length >= 4}
                      className="rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-xs text-white/75 hover:bg-white/10 disabled:opacity-40"
                    >
                      Upload Reference File
                    </button>
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      hidden
                      onChange={handleExternalFile}
                    />
                    <span className="text-[10px] text-white/35">JPG, PNG, WEBP</span>
                  </div>
                  {externalError && (
                    <p className="mt-2 text-[11px] text-red-300/85">{externalError}</p>
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => onSaveReferences(normalizeSceneReferenceBindings(draftBindings))}
                  className="w-full rounded-2xl bg-gradient-to-r from-insta-mid to-insta-purple px-4 py-3 text-sm font-semibold text-white"
                >
                  Save Scene References
                </button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default SceneReferencePickerModal;
