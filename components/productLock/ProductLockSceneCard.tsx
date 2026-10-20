import React, { useState } from 'react';
import type { PlannedStoryboardScene, SceneRoute } from '../../types/brand';
import { resolveSceneIdeaRoute } from '../../services/sceneRouter';
import { getSceneRouteLabel, getSceneRouteTone } from './productLockViewUtils';

interface AssetOption {
  id: string;
  label: string;
}

interface Props {
  idea: PlannedStoryboardScene;
  index: number;
  totalScenes: number;
  isSelected: boolean;
  statusLabel: string;
  requirementTitle: string;
  requirementDetail: string;
  currentSourceLabel: string;
  assetOptions: AssetOption[];
  isGenerating: boolean;
  onSelect: () => void;
  onApprove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onQuickGenerate: () => void;
  onCancel: () => void;
  onDelete: () => void;
  onUpdateImagePrompt: (value: string) => void;
  onUpdateRoute: (value: SceneRoute) => void;
  onAssignBaseAsset: (assetId: string) => void;
}

const ProductLockSceneCard: React.FC<Props> = ({
  idea,
  index,
  totalScenes,
  isSelected,
  statusLabel,
  requirementTitle,
  requirementDetail,
  currentSourceLabel,
  assetOptions,
  isGenerating,
  onSelect,
  onApprove,
  onMoveUp,
  onMoveDown,
  onQuickGenerate,
  onCancel,
  onDelete,
  onUpdateImagePrompt,
  onUpdateRoute,
  onAssignBaseAsset,
}) => {
  const [confirmDelete, setConfirmDelete] = useState(false);
  const activeRoute = resolveSceneIdeaRoute(idea);

  const visualTaskLabel = idea.visualTask
    ? idea.visualTask === 'use_imported'
      ? 'Use Imported'
      : idea.visualTask === 'edit_imported'
        ? 'Edit Imported'
        : idea.visualTask === 'overlay_on_product'
          ? 'Overlay / Composite'
          : 'Generate New'
    : null;

  return (
    <div className={`rounded-xl border p-4 space-y-3 ${isSelected ? 'border-cyan-400 bg-cyan-500/5' : 'border-dark-border bg-dark-card'}`}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <p className="text-[11px] uppercase tracking-wider text-purple-300">Scene {index + 1}</p>
            <p className="text-[10px] uppercase tracking-wider text-emerald-300">Suggested #{idea.suggestedPosition}</p>
            {visualTaskLabel && (
              <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold border ${
                idea.visualTask === 'use_imported'
                  ? 'bg-emerald-500/10 text-emerald-200 border-emerald-500/20'
                  : idea.visualTask === 'edit_imported'
                    ? 'bg-indigo-500/10 text-indigo-200 border-indigo-500/20'
                    : idea.visualTask === 'overlay_on_product'
                      ? 'bg-fuchsia-500/10 text-fuchsia-200 border-fuchsia-500/20'
                      : 'bg-amber-500/10 text-amber-200 border-amber-500/20'
              }`}
              >
                {visualTaskLabel}
              </span>
            )}
          </div>
          <p className="mt-1 text-sm font-medium text-white">{idea.text}</p>
          {idea.directorsNote && (
            <div className="mt-2 flex items-start gap-2 rounded-lg border border-purple-500/20 bg-purple-500/5 p-2 mb-2">
              <span className="mt-0.5 text-[10px]">🎬</span>
              <p className="text-[11px] italic text-purple-200/80 leading-relaxed">
                <span className="font-bold text-purple-300 not-italic uppercase tracking-tighter mr-1">Director's Note:</span>
                {idea.directorsNote}
              </p>
            </div>
          )}
        </div>
        <span className={`rounded-full px-2 py-1 text-[10px] font-semibold ${
          idea.approved
            ? 'bg-emerald-500/15 text-emerald-200'
            : idea.selectedVariantAssetId
              ? 'bg-cyan-500/15 text-cyan-200'
              : idea.baseAssetId
                ? 'bg-indigo-500/15 text-indigo-200'
                : 'bg-amber-500/15 text-amber-200'
        }`}>
          {statusLabel}
        </span>
      </div>
      <div className="rounded-lg border border-white/10 bg-black/20 p-3">
        <p className="text-[10px] uppercase tracking-wider text-cyan-300">{requirementTitle}</p>
        <p className="mt-1 text-[11px] text-gray-300">{requirementDetail}</p>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-[12px] text-gray-400">
        <p>Visual: {idea.visualDescription}</p>
        <p className="flex items-center gap-1.5">
          Current source: {currentSourceLabel}
          {idea.visualGap && (
            <span className="inline-flex items-center rounded bg-amber-500/20 px-1.5 py-0.5 text-[9px] font-bold text-amber-300 ring-1 ring-inset ring-amber-500/30 animate-pulse">
              VISUAL GAP
            </span>
          )}
        </p>
      </div>
      {idea.productTitle && (
        <p className="text-[11px] text-cyan-200">Product: {idea.productTitle}</p>
      )}
      {idea.visualTaskReason && (
        <div className="rounded-lg border border-white/10 bg-black/20 px-3 py-2">
          <p className="text-[10px] uppercase tracking-wider text-gray-500">Why this visual</p>
          <p className="mt-1 text-[12px] text-gray-300">{idea.visualTaskReason}</p>
        </div>
      )}
      <textarea
        value={idea.imagePrompt}
        onChange={(e) => onUpdateImagePrompt(e.target.value)}
        placeholder="Refine this scene prompt directly here before generating"
        className="w-full min-h-[84px] rounded-lg border border-dark-border bg-black/20 px-3 py-2 text-[12px] text-white outline-none"
      />
      <div className="md:col-span-2">
        <div className="flex flex-wrap gap-2">
          {(['use_existing', 'upgrade_existing', 'composite_product', 'generate_fresh', 'continue_sequence'] as SceneRoute[]).map((route) => (
            <button
              key={route}
              onClick={() => onUpdateRoute(route)}
              className={`px-3 py-1.5 rounded-lg text-[11px] font-medium border transition-colors ${
                activeRoute === route
                  ? getSceneRouteTone(route)
                  : 'bg-black/20 text-gray-400 border-dark-border hover:bg-white/5 hover:text-white'
              }`}
            >
              {getSceneRouteLabel(route)}
            </button>
          ))}
        </div>
      </div>
      {isSelected ? (
        <div className="grid grid-cols-1 gap-2">
          <select
            value={idea.baseAssetId || idea.agencySuggestedBaseAssetId || ''}
            onChange={(e) => onAssignBaseAsset(e.target.value)}
            className="w-full rounded-lg border border-dark-border bg-black/20 px-3 py-2 text-[11px] text-white outline-none"
          >
            <option value="">Choose a base asset for this scene</option>
            {assetOptions.map((asset) => (
              <option key={asset.id} value={asset.id}>{asset.label}</option>
            ))}
          </select>
        </div>
      ) : (
        <p className="text-[11px] text-gray-500">Select this scene to assign a base asset from its product set.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          onClick={onSelect}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${isSelected ? 'bg-cyan-500/15 text-cyan-200 border-cyan-500/30' : 'bg-white/5 text-white border-dark-border'}`}
        >
          {isSelected ? 'Selected Scene' : 'Edit Scene'}
        </button>
        <button
          onClick={onApprove}
          className={`px-3 py-1.5 rounded-lg text-[11px] font-semibold border ${idea.approved ? 'bg-emerald-500/15 text-emerald-200 border-emerald-500/30' : 'bg-white/5 text-white border-dark-border'}`}
        >
          {idea.approved ? 'Approved' : 'Approve'}
        </button>
        <button
          onClick={onMoveUp}
          disabled={index === 0}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-white/5 text-white border-dark-border disabled:opacity-40"
        >
          Up
        </button>
        <button
          onClick={onMoveDown}
          disabled={index === totalScenes - 1}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-white/5 text-white border-dark-border disabled:opacity-40"
        >
          Down
        </button>
        <button
          onClick={onQuickGenerate}
          disabled={isGenerating}
          className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-emerald-500/10 text-emerald-200 border-emerald-500/20 disabled:opacity-50"
        >
          {isGenerating ? 'Generating...' : 'Quick Generate'}
        </button>
        {isGenerating && (
          <button
            onClick={onCancel}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-red-500/10 text-red-200 border-red-500/20"
          >
            Cancel
          </button>
        )}
        {confirmDelete ? (
          <div className="flex gap-1">
            <button
              onClick={onDelete}
              className="px-3 py-1.5 rounded-lg text-[11px] font-bold border bg-red-600/30 text-white border-red-500 animate-pulse"
            >
              Confirm Delete
            </button>
            <button
              onClick={() => setConfirmDelete(false)}
              className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-dark-bg text-gray-300 border-dark-border"
            >
              Cancel
            </button>
          </div>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="px-3 py-1.5 rounded-lg text-[11px] font-semibold border bg-red-500/10 text-red-200 border-red-500/20"
          >
            Delete
          </button>
        )}
      </div>
    </div>
  );
};

export default ProductLockSceneCard;
