import React, { useState, useEffect, useCallback } from 'react';
import { StudioAsset } from './types';
import { resolveStudioAssetSrc } from './utils';

export interface AssetDetailPanelProps {
  asset: StudioAsset;
  onClose: () => void;
  onDelete: (id: string) => void;
  onDownload: (asset: StudioAsset) => void;
  onRegenerate: (asset: StudioAsset) => void;
  onRename: (id: string, name: string, description?: string) => void;
  onOpenVideoStudio?: (asset: StudioAsset) => void;
}

/**
 * AssetDetailPanel — displays full-size image preview, metadata,
 * and management actions (download, delete, re-generate, rename).
 *
 * Requirements: 9.1, 9.2, 9.3, 9.4, 9.5
 */
const AssetDetailPanel: React.FC<AssetDetailPanelProps> = ({
  asset,
  onClose,
  onDelete,
  onDownload,
  onRegenerate,
  onRename,
  onOpenVideoStudio,
}) => {
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showFullPreview, setShowFullPreview] = useState(false);
  const [previewScale, setPreviewScale] = useState<'fit' | 'actual'>('fit');
  const [editingName, setEditingName] = useState(false);
  const [editingDescription, setEditingDescription] = useState(false);
  const [nameValue, setNameValue] = useState(asset.name);
  const [descriptionValue, setDescriptionValue] = useState(asset.description);

  // Sync local state when asset changes
  useEffect(() => {
    setNameValue(asset.name);
    setDescriptionValue(asset.description);
  }, [asset.name, asset.description]);

  // Escape key to close panel
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (showFullPreview) {
          setShowFullPreview(false);
        } else if (showDeleteConfirm) {
          setShowDeleteConfirm(false);
        } else {
          onClose();
        }
      }
    },
    [onClose, showDeleteConfirm, showFullPreview]
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  const handleNameSave = () => {
    const trimmed = nameValue.trim();
    if (trimmed && trimmed !== asset.name) {
      onRename(asset.id, trimmed, asset.description);
    }
    setEditingName(false);
  };

  const handleDescriptionSave = () => {
    const trimmed = descriptionValue.trim();
    if (trimmed !== asset.description) {
      onRename(asset.id, asset.name, trimmed);
    }
    setEditingDescription(false);
  };

  const handleDeleteClick = () => {
    setShowDeleteConfirm(true);
  };

  const handleDeleteConfirm = () => {
    onDelete(asset.id);
    setShowDeleteConfirm(false);
  };

  const handleDeleteCancel = () => {
    setShowDeleteConfirm(false);
  };

  const formattedDate = new Date(asset.createdAt).toLocaleString();
  const isGenerated = asset.source === 'generated';

  return (
    <div
      className="flex flex-col h-full bg-studio-surface border-l border-studio-border overflow-y-auto"
      role="dialog"
      aria-label="Asset detail panel"
    >
      {/* Header with close button */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-studio-border">
        <h2 className="text-white font-semibold text-sm truncate">Asset Details</h2>
        <button
          type="button"
          onClick={onClose}
          className="min-w-[24px] min-h-[24px] p-1 rounded text-gray-400 hover:text-white hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          aria-label="Close detail panel"
        >
          ✕
        </button>
      </div>

      {/* Full-size image preview — click for fullscreen */}
      <div className="px-4 py-3">
        <button
          type="button"
          onClick={() => setShowFullPreview(true)}
          className="w-full cursor-zoom-in group relative rounded-lg overflow-hidden border border-studio-border hover:border-blue-500/50 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
          aria-label="View full-size image"
          title="Click to view full size"
        >
          <img
            src={resolveStudioAssetSrc(asset)}
            alt={asset.name || 'Asset preview'}
            className="w-full max-h-[400px] object-contain"
          />
          <div className="absolute inset-0 bg-studio-canvas/0 group-hover:bg-studio-canvas/20 transition-colors flex items-center justify-center">
            <span className="opacity-0 group-hover:opacity-100 transition-opacity text-white text-sm bg-studio-canvas/60 px-3 py-1.5 rounded-full">
              🔍 Full Preview
            </span>
          </div>
        </button>
      </div>

      {/* Generation Prompt — shown prominently for generated assets */}
      {isGenerated && asset.generationPrompt && (
        <div className="px-4 py-2">
          <div className="bg-gradient-to-r from-studio-accent/20 to-cyan-900/30 border border-studio-accent/20 rounded-lg p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <span className="text-xs font-semibold text-teal-200 uppercase tracking-wider">✨ Generation Prompt</span>
              {asset.creativeRoute && (
                <span className="text-[10px] bg-studio-accent/20 text-teal-200 px-2 py-0.5 rounded-full capitalize">
                  {asset.creativeRoute.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')}
                </span>
              )}
            </div>
            <p className="text-sm text-gray-200 leading-relaxed break-words">
              {asset.generationPrompt}
            </p>
          </div>
        </div>
      )}

      {/* Editable name */}
      <div className="px-4 py-2">
        {editingName ? (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={nameValue}
              onChange={(e) => setNameValue(e.target.value.slice(0, 100))}
              onBlur={handleNameSave}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleNameSave();
                if (e.key === 'Escape') {
                  setNameValue(asset.name);
                  setEditingName(false);
                }
              }}
              maxLength={100}
              className="flex-1 bg-studio-canvas/30 border border-studio-border rounded px-2 py-1 text-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Asset name"
              autoFocus
            />
            <span className="text-xs text-gray-500">{nameValue.length}/100</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingName(true)}
            className="text-left w-full text-white font-medium text-sm hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1 py-0.5"
            aria-label="Edit asset name"
            title="Click to rename"
          >
            {asset.name || 'Untitled'}
          </button>
        )}
      </div>

      {/* Editable description */}
      <div className="px-4 py-2">
        {editingDescription ? (
          <div className="flex flex-col gap-1">
            <textarea
              value={descriptionValue}
              onChange={(e) => setDescriptionValue(e.target.value.slice(0, 500))}
              onBlur={handleDescriptionSave}
              onKeyDown={(e) => {
                if (e.key === 'Escape') {
                  setDescriptionValue(asset.description);
                  setEditingDescription(false);
                }
              }}
              maxLength={500}
              rows={3}
              className="w-full bg-studio-canvas/30 border border-studio-border rounded px-2 py-1 text-gray-300 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
              aria-label="Asset description"
              autoFocus
            />
            <span className="text-xs text-gray-500 self-end">{descriptionValue.length}/500</span>
          </div>
        ) : (
          <button
            type="button"
            onClick={() => setEditingDescription(true)}
            className="text-left w-full text-gray-400 text-sm hover:text-blue-400 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 rounded px-1 py-0.5"
            aria-label="Edit asset description"
            title="Click to edit description"
          >
            {asset.description || 'Add a description…'}
          </button>
        )}
      </div>

      {/* Metadata */}
      <div className="px-4 py-3 border-t border-studio-border">
        <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
          Metadata
        </h3>
        <dl className="space-y-1.5 text-sm">
          <div className="flex justify-between">
            <dt className="text-gray-400">Dimensions</dt>
            <dd className="text-white">{asset.width} × {asset.height}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-400">Created</dt>
            <dd className="text-white">{formattedDate}</dd>
          </div>
          <div className="flex justify-between">
            <dt className="text-gray-400">Source</dt>
            <dd className="text-white capitalize">{asset.source.replace('_', ' ')}</dd>
          </div>
          {isGenerated && asset.aspectRatio && (
            <div className="flex justify-between">
              <dt className="text-gray-400">Aspect Ratio</dt>
              <dd className="text-white">{asset.aspectRatio}</dd>
            </div>
          )}
        </dl>
      </div>

      {/* AI Generation metadata (only for generated assets) */}
      {isGenerated && (
        <div className="px-4 py-3 border-t border-studio-border">
          <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-2">
            Generation Info
          </h3>
          <dl className="space-y-1.5 text-sm">
            {asset.creativeRoute && (
              <div className="flex justify-between">
                <dt className="text-gray-400">Creative Route</dt>
                <dd className="text-white capitalize">
                  {asset.creativeRoute.replace('_', ' ')}
                </dd>
              </div>
            )}
            {asset.sourceAssetIds && asset.sourceAssetIds.length > 0 && (
              <div className="flex justify-between">
                <dt className="text-gray-400">Source Assets</dt>
                <dd className="text-white">{asset.sourceAssetIds.length} reference(s)</dd>
              </div>
            )}
          </dl>
        </div>
      )}

      {/* Actions */}
      <div className="px-4 py-3 mt-auto border-t border-studio-border space-y-2">
        <button
          type="button"
          onClick={() => onDownload(asset)}
          className="w-full min-h-[36px] px-3 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
          aria-label="Download asset"
        >
          ⬇ Download
        </button>

        {onOpenVideoStudio && resolveStudioAssetSrc(asset) && (
          <button
            type="button"
            onClick={() => onOpenVideoStudio(asset)}
            className="w-full min-h-[36px] px-3 py-2 rounded-lg bg-teal-700/80 hover:bg-teal-600 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-teal-500 focus:ring-offset-1"
            aria-label="Open in Video Studio"
          >
            Open in Video Studio
          </button>
        )}

        {isGenerated && (
          <button
            type="button"
            onClick={() => onRegenerate(asset)}
            className="w-full min-h-[36px] px-3 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500 focus:ring-offset-1"
            aria-label="Re-generate with same settings"
          >
            🔄 Re-generate
          </button>
        )}

        <button
          type="button"
          onClick={handleDeleteClick}
          className="w-full min-h-[36px] px-3 py-2 rounded-lg bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 text-sm font-medium border border-red-600/30 transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
          aria-label="Delete asset"
        >
          🗑 Delete
        </button>
      </div>

      {/* Full-screen image lightbox */}
      {showFullPreview && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-studio-canvas/90 backdrop-blur-sm"
          role="dialog"
          aria-label="Full-size image preview"
        >
          <div className="relative flex h-full w-full flex-col items-center p-4">
            <div className="absolute right-4 top-4 z-20 flex items-center gap-2 rounded-xl border border-white/10 bg-studio-canvas/80 p-1 shadow-xl backdrop-blur-md">
              <div role="group" aria-label="Full preview zoom" className="flex">
                <button type="button" aria-pressed={previewScale === 'fit'} onClick={() => setPreviewScale('fit')} className={`rounded-lg px-3 py-2 text-xs ${previewScale === 'fit' ? 'bg-white/15 text-white' : 'text-gray-400'}`}>Fit</button>
                <button type="button" aria-pressed={previewScale === 'actual'} onClick={() => setPreviewScale('actual')} className={`rounded-lg px-3 py-2 text-xs ${previewScale === 'actual' ? 'bg-white/15 text-white' : 'text-gray-400'}`}>100%</button>
              </div>
            <button
              type="button"
              onClick={() => { setShowFullPreview(false); setPreviewScale('fit'); }}
              className="w-9 h-9 rounded-full hover:bg-white/10 text-white flex items-center justify-center transition-colors"
              aria-label="Close full preview"
            >
              ✕
            </button>
            </div>
            <div className={`flex min-h-0 w-full flex-1 ${previewScale === 'fit' ? 'items-center justify-center overflow-hidden' : 'overflow-auto'}`}>
            <img
              src={resolveStudioAssetSrc(asset)}
              alt={asset.name || 'Full-size preview'}
              className={previewScale === 'fit' ? 'max-h-full max-w-full object-contain rounded-lg' : 'm-auto h-auto w-auto max-w-none rounded-lg'}
            />
            </div>
            {/* Prompt overlay at bottom */}
            {isGenerated && asset.generationPrompt && (
              <div
                className="mt-3 max-h-[18vh] max-w-2xl overflow-y-auto bg-studio-canvas/70 backdrop-blur-sm border border-white/10 rounded-xl px-4 py-3"
              >
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-semibold text-teal-200">✨ Prompt</span>
                  {asset.creativeRoute && (
                    <span className="text-[10px] bg-studio-accent/20 text-teal-200 px-2 py-0.5 rounded-full capitalize">
                      {asset.creativeRoute.split('_').map((part) => part.charAt(0).toUpperCase() + part.slice(1)).join(' ')}
                    </span>
                  )}
                </div>
                <p className="text-sm text-gray-200 leading-relaxed">{asset.generationPrompt}</p>
              </div>
            )}
            {/* Image info */}
            <div className="mt-2 text-xs text-gray-400">
              {asset.width} × {asset.height} • {asset.mimeType.split('/')[1].toUpperCase()} • {formattedDate}
            </div>
          </div>
        </div>
      )}

      {/* Delete confirmation dialog */}
      {showDeleteConfirm && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-studio-canvas/60"
          role="alertdialog"
          aria-labelledby="delete-confirm-title"
          aria-describedby="delete-confirm-desc"
        >
          <div className="bg-studio-surface border border-studio-border rounded-xl p-6 max-w-sm mx-4 shadow-xl">
            <h3
              id="delete-confirm-title"
              className="text-white font-semibold text-lg mb-2"
            >
              Delete Asset?
            </h3>
            <p
              id="delete-confirm-desc"
              className="text-gray-400 text-sm mb-5"
            >
              This will permanently remove &ldquo;{asset.name || 'Untitled'}&rdquo; from the studio.
              This action cannot be undone.
            </p>
            <div className="flex gap-3 justify-end">
              <button
                type="button"
                onClick={handleDeleteCancel}
                className="min-w-[24px] min-h-[36px] px-4 py-2 rounded-lg text-gray-300 hover:text-white hover:bg-white/10 text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-1"
                aria-label="Cancel deletion"
                autoFocus
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={handleDeleteConfirm}
                className="min-w-[24px] min-h-[36px] px-4 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-1"
                aria-label="Confirm deletion"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default AssetDetailPanel;
