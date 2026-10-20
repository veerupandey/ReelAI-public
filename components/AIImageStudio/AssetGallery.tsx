import React, { useCallback } from 'react';
import type { StudioAsset } from './types';
import { resolveStudioAssetSrc, truncateText } from './utils';

/**
 * Props for the AssetGallery component.
 */
export interface AssetGalleryProps {
  assets: StudioAsset[];
  gallerySelectionIds: Set<string>;
  /** Ordered Instagram post queue — shows 1/2/3 badges */
  postQueueIds?: string[];
  multiSelectEnabled: boolean;
  viewMode: 'default' | 'compact';
  detailAssetId: string | null;
  onToggleSelect: (id: string) => void;
  /** When set, Shift/Alt+click or dedicated control adds to post queue; default click still locks */
  onTogglePostQueue?: (id: string) => void;
  onOpenDetail: (id: string) => void;
  /** Optional: mark assets excluded from storyboard / downstream use. */
  excludedIds?: ReadonlySet<string> | readonly string[];
  /** Optional: toggle exclude/restore from the card. */
  onToggleExcluded?: (id: string) => void;
  /** Badge text for selected cards. Default "Locked" (main studio). Agency uses "Selected". */
  selectionBadgeLabel?: string;
  /** Empty-state copy when assets array is empty. */
  emptyMessage?: string;
}

/**
 * Props for the AssetCard sub-component.
 */
interface AssetCardProps {
  asset: StudioAsset;
  isSelected: boolean;
  postQueueIndex: number | null;
  isDetailOpen: boolean;
  isExcluded: boolean;
  multiSelectEnabled: boolean;
  viewMode: 'default' | 'compact';
  selectionBadgeLabel: string;
  onToggleSelect: (id: string) => void;
  onTogglePostQueue?: (id: string) => void;
  onOpenDetail: (id: string) => void;
  onToggleExcluded?: (id: string) => void;
}

function isIdExcluded(
  excludedIds: ReadonlySet<string> | readonly string[] | undefined,
  id: string,
): boolean {
  if (!excludedIds) return false;
  if (Array.isArray(excludedIds)) return excludedIds.includes(id);
  return (excludedIds as ReadonlySet<string>).has(id);
}

/**
 * AssetCard — renders a single asset thumbnail with selection state,
 * AI badge, and truncated name.
 */
const AssetCard: React.FC<AssetCardProps> = ({
  asset,
  isSelected,
  postQueueIndex,
  isDetailOpen,
  isExcluded,
  multiSelectEnabled,
  viewMode,
  selectionBadgeLabel,
  onToggleSelect,
  onTogglePostQueue,
  onOpenDetail,
  onToggleExcluded,
}) => {
  const isCompact = viewMode === 'compact';
  const imageSrc = resolveStudioAssetSrc(asset);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Alt/Option+click adds to Instagram post queue in order
    if (e.altKey && onTogglePostQueue) {
      e.preventDefault();
      onTogglePostQueue(asset.id);
      return;
    }
    onToggleSelect(asset.id);
  }, [onToggleSelect, onTogglePostQueue, asset.id]);

  const handleDoubleClick = useCallback(() => {
    onOpenDetail(asset.id);
  }, [onOpenDetail, asset.id]);

  const handleDetailClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onOpenDetail(asset.id);
  }, [onOpenDetail, asset.id]);

  const handleQueueClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onTogglePostQueue?.(asset.id);
  }, [onTogglePostQueue, asset.id]);

  const handleExcludeClick = useCallback((e: React.MouseEvent) => {
    e.stopPropagation();
    onToggleExcluded?.(asset.id);
  }, [onToggleExcluded, asset.id]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        onToggleSelect(asset.id);
      }
      if ((e.key === 'q' || e.key === 'Q') && onTogglePostQueue) {
        e.preventDefault();
        onTogglePostQueue(asset.id);
      }
    },
    [onToggleSelect, onTogglePostQueue, asset.id],
  );

  return (
    <div
      role="button"
      tabIndex={0}
      aria-label={`${asset.name}${isSelected ? ', selected' : ''}${postQueueIndex != null ? `, post slide ${postQueueIndex}` : ''}${isExcluded ? ', excluded' : ''}`}
      aria-pressed={isSelected}
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      onKeyDown={handleKeyDown}
      className={`relative group rounded-xl overflow-hidden cursor-pointer transition-all duration-150 focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas bg-studio-surface ${
        isExcluded ? 'opacity-45' : ''
      } ${
        isSelected
          ? 'ring-2 ring-studio-accent ring-offset-1 ring-offset-studio-canvas'
          : isDetailOpen
          ? 'ring-2 ring-white/30 ring-offset-1 ring-offset-studio-canvas'
          : postQueueIndex != null
          ? 'ring-2 ring-pink-400/60 ring-offset-1 ring-offset-studio-canvas'
          : 'ring-1 ring-white/5 hover:ring-white/15'
      }`}
    >
      {/* Thumbnail — square aspect */}
      <div className="w-full aspect-square overflow-hidden bg-black/40">
        {imageSrc ? (
          <img
            src={imageSrc}
            alt={asset.name}
            className="w-full h-full object-cover transition-transform duration-200 group-hover:scale-[1.03]"
            draggable={false}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center px-2 text-center text-[10px] text-gray-500">
            {truncateText(asset.name, 36)}
          </div>
        )}
      </div>

      {/* Hover overlay — name + detail / exclude / queue */}
      {!isCompact && (
        <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-150 flex flex-col justify-end p-2 pointer-events-none group-hover:pointer-events-auto">
          <div className="flex items-end justify-between gap-1">
            <p className="text-[11px] text-white font-medium truncate leading-tight drop-shadow">
              {truncateText(asset.name, 28)}
            </p>
            <div className="flex items-center gap-1 flex-shrink-0">
              {onTogglePostQueue && (
                <button
                  type="button"
                  onClick={handleQueueClick}
                  className={`px-1.5 h-6 rounded-md text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm transition-colors focus:outline-none ${
                    postQueueIndex != null
                      ? 'bg-pink-500/90 text-white hover:bg-pink-500'
                      : 'bg-white/15 text-white hover:bg-pink-500/80'
                  }`}
                  aria-label={
                    postQueueIndex != null
                      ? `Remove ${asset.name} from Instagram post queue`
                      : `Add ${asset.name} to Instagram post queue`
                  }
                  title={postQueueIndex != null ? 'Remove from post queue' : 'Add to post queue (Alt+click)'}
                >
                  {postQueueIndex != null ? `#${postQueueIndex}` : 'IG+'}
                </button>
              )}
              {onToggleExcluded && (
                <button
                  type="button"
                  onClick={handleExcludeClick}
                  className={`px-1.5 h-6 rounded-md text-[9px] font-bold uppercase tracking-wide backdrop-blur-sm transition-colors focus:outline-none ${
                    isExcluded
                      ? 'bg-emerald-500/80 text-white hover:bg-emerald-500'
                      : 'bg-red-500/70 text-white hover:bg-red-500'
                  }`}
                  aria-label={isExcluded ? `Restore ${asset.name}` : `Exclude ${asset.name}`}
                  title={isExcluded ? 'Restore for storyboard' : 'Exclude from storyboard'}
                >
                  {isExcluded ? 'Restore' : 'Exclude'}
                </button>
              )}
              <button
                type="button"
                onClick={handleDetailClick}
                className="flex-shrink-0 w-6 h-6 rounded-md bg-white/15 hover:bg-white/30 backdrop-blur-sm flex items-center justify-center transition-colors focus:outline-none"
                aria-label={`Preview ${asset.name}`}
                title="Open preview"
              >
                <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607zM10.5 7.5v6m3-3h-6" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Post queue order badge — top-left preferred when queued */}
      {postQueueIndex != null && (
        <div className="absolute top-1.5 left-1.5 z-20 flex h-6 w-6 items-center justify-center rounded-full bg-gradient-to-br from-[#f09433] via-[#dc2743] to-[#bc1888] border border-white/30 text-[11px] font-bold text-white shadow-md">
          {postQueueIndex}
        </div>
      )}

      {/* Selection badge — top-left (offset when queue badge present) */}
      {isSelected && (
        <div
          className={`absolute z-10 flex items-center gap-1 rounded-full bg-studio-accent/95 border border-white/20 px-1.5 py-0.5 shadow-md ${
            postQueueIndex != null ? 'top-1.5 left-9' : 'top-1.5 left-1.5'
          }`}
        >
          <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 10.5V6.75a4.5 4.5 0 10-9 0v3.75m-.75 11.25h10.5a2.25 2.25 0 002.25-2.25v-6.75a2.25 2.25 0 00-2.25-2.25H6.75a2.25 2.25 0 00-2.25 2.25v6.75a2.25 2.25 0 002.25 2.25z" />
          </svg>
          <span className="text-[9px] font-bold uppercase tracking-wide text-white">{selectionBadgeLabel}</span>
        </div>
      )}

      {/* Multi-select checkbox (when multiselect mode active and not yet selected) */}
      {multiSelectEnabled && !isSelected && postQueueIndex == null && (
        <div className="absolute top-1.5 left-1.5 z-10 w-5 h-5 rounded-full border-2 border-white/40 bg-studio-canvas/40 backdrop-blur-sm" aria-hidden="true" />
      )}

      {/* Excluded badge — bottom-left when not hovering (compact always shows) */}
      {isExcluded && (
        <div className="absolute bottom-1.5 left-1.5 z-10 rounded-full bg-red-500/90 px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-white shadow">
          Excluded
        </div>
      )}

      {/* AI badge — top-right */}
      {asset.source === 'generated' && (
        <div className="absolute top-1.5 right-1.5 z-10 flex flex-col items-end gap-1">
          <span className="px-1.5 py-0.5 rounded-full bg-studio-accent/80 backdrop-blur-sm text-white text-[9px] font-bold uppercase tracking-wide shadow">
            AI
          </span>
          {asset.carouselSetId && asset.carouselSlideIndex != null && (
            <span className="px-1.5 py-0.5 rounded-full bg-studio-canvas/70 text-teal-100 text-[9px] font-semibold shadow">
              Slide {asset.carouselSlideIndex}
            </span>
          )}
          {!asset.carouselSetId && asset.variationSetId && asset.variationIndex != null && (
            <span className="px-1.5 py-0.5 rounded-full bg-studio-canvas/70 text-teal-100 text-[9px] font-semibold shadow">
              V{asset.variationIndex}
            </span>
          )}
          {asset.brandCompliancePending && (
            <span
              className="h-2 w-2 animate-pulse rounded-full bg-teal-300 shadow"
              title="Checking brand compliance"
              aria-label="Checking brand compliance"
            />
          )}
          {asset.brandCompliance && !asset.brandCompliancePending && (
            <span
              className={`rounded-full px-1.5 py-0.5 text-[9px] font-bold shadow ${
                asset.brandCompliance.status === 'pass'
                  ? 'bg-emerald-500/85 text-white'
                  : asset.brandCompliance.status === 'warning'
                    ? 'bg-amber-500/85 text-black'
                    : 'bg-red-500/85 text-white'
              }`}
              title={`Brand compliance ${asset.brandCompliance.score}/100`}
              aria-label={`Brand compliance ${asset.brandCompliance.score} out of 100`}
            >
              {asset.brandCompliance.score}
            </span>
          )}
        </div>
      )}
    </div>
  );
};

/**
 * AssetGallery — displays all loaded assets in a responsive grid layout
 * with scroll-based navigation. Supports default and compact view modes,
 * multi-select with checkboxes, and drag-and-drop zone for file imports.
 *
 * Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.2, 4.3
 */
const AssetGallery: React.FC<AssetGalleryProps> = ({
  assets,
  gallerySelectionIds,
  postQueueIds = [],
  multiSelectEnabled,
  viewMode,
  detailAssetId,
  onToggleSelect,
  onTogglePostQueue,
  onOpenDetail,
  excludedIds,
  onToggleExcluded,
  selectionBadgeLabel = 'Locked',
  emptyMessage = 'No images yet',
}) => {
  const gridClasses =
    viewMode === 'compact'
      ? 'grid-cols-4 sm:grid-cols-5 lg:grid-cols-6 2xl:grid-cols-8 gap-1.5'
      : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6 gap-2';

  const [isDragOver, setIsDragOver] = React.useState(false);
  const postQueueIndexById = React.useMemo(() => {
    const map = new Map<string, number>();
    postQueueIds.forEach((id, index) => map.set(id, index + 1));
    return map;
  }, [postQueueIds]);

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
    // Drop handling is managed by the parent AIImageStudioScreen
    // This component just provides the visual drop zone
  }, []);

  return (
    <div
      className={`flex-1 overflow-y-auto p-2 rounded-xl transition-all duration-150 ${
        isDragOver
          ? 'bg-studio-accent/10 ring-2 ring-dashed ring-studio-accent/50'
          : ''
      }`}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      role="grid"
      aria-label="Asset gallery"
    >
      {assets.length === 0 ? (
        <div className="flex min-h-[200px] items-center justify-center px-4 text-center text-sm text-gray-500">
          {emptyMessage}
        </div>
      ) : (
        <div className={`grid ${gridClasses}`}>
          {assets.map((asset) => (
            <AssetCard
              key={asset.id}
              asset={asset}
              isSelected={gallerySelectionIds.has(asset.id)}
              postQueueIndex={postQueueIndexById.get(asset.id) ?? null}
              isDetailOpen={detailAssetId === asset.id}
              isExcluded={isIdExcluded(excludedIds, asset.id)}
              multiSelectEnabled={multiSelectEnabled}
              viewMode={viewMode}
              selectionBadgeLabel={selectionBadgeLabel}
              onToggleSelect={onToggleSelect}
              onTogglePostQueue={onTogglePostQueue}
              onOpenDetail={onOpenDetail}
              onToggleExcluded={onToggleExcluded}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default AssetGallery;
