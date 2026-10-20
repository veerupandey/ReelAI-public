import React, { useEffect, useState } from 'react';
import type { StudioAsset } from './types';
import { resolveStudioAssetSrc } from './utils';

export interface StudioCompareViewProps {
  left: StudioAsset;
  right: StudioAsset;
  onClose: () => void;
  onSwap?: () => void;
}

/**
 * Side-by-side comparison with optional ghost overlay of left onto right.
 */
const StudioCompareView: React.FC<StudioCompareViewProps> = ({ left, right, onClose, onSwap }) => {
  const [ghostEnabled, setGhostEnabled] = useState(false);
  const [ghostOpacity, setGhostOpacity] = useState(0.3);
  const [overlayFit, setOverlayFit] = useState<'contain' | 'cover'>('contain');
  const [reviewScale, setReviewScale] = useState<'fit' | 'actual'>('fit');

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
      if (event.key === 'g' || event.key === 'G') setGhostEnabled((value) => !value);
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-[85] flex flex-col bg-studio-canvas/95 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label="Compare images"
    >
      <div className="flex items-center justify-between px-4 py-3 border-b border-white/10 gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold text-white">Compare</h2>
          <p className="text-[11px] text-gray-400">Side-by-side review · press G for ghost overlay</p>
        </div>
        <div className="flex items-center gap-2 flex-shrink-0 flex-wrap justify-end">
          <div className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5" role="group" aria-label="Compare zoom">
            <button type="button" aria-pressed={reviewScale === 'fit'} onClick={() => setReviewScale('fit')} className={`rounded-md px-2.5 py-1 text-xs ${reviewScale === 'fit' ? 'bg-white/15 text-white' : 'text-gray-400'}`}>Fit</button>
            <button type="button" aria-pressed={reviewScale === 'actual'} onClick={() => setReviewScale('actual')} className={`rounded-md px-2.5 py-1 text-xs ${reviewScale === 'actual' ? 'bg-white/15 text-white' : 'text-gray-400'}`}>100%</button>
          </div>
          <button
            type="button"
            onClick={() => setGhostEnabled((value) => !value)}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium border ${
              ghostEnabled
                ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                : 'border-white/10 bg-white/5 text-gray-200 hover:bg-white/10'
            }`}
          >
            Ghost overlay {ghostEnabled ? 'on' : 'off'}
          </button>
          {ghostEnabled && (
            <>
              <label className="flex items-center gap-2 text-[11px] text-gray-400">
                <input
                  type="range"
                  min={10}
                  max={70}
                  value={Math.round(ghostOpacity * 100)}
                  onChange={(event) => setGhostOpacity(Number(event.target.value) / 100)}
                  className="w-24"
                  aria-label="Ghost overlay opacity"
                />
                <span className="text-gray-300 w-8">{Math.round(ghostOpacity * 100)}%</span>
              </label>
              <div
                className="flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 p-0.5"
                role="radiogroup"
                aria-label="Compare overlay alignment"
              >
                {(['contain', 'cover'] as const).map((fit) => (
                  <button
                    key={fit}
                    type="button"
                    role="radio"
                    aria-checked={overlayFit === fit}
                    onClick={() => setOverlayFit(fit)}
                    className={`rounded-md px-2 py-1 text-[10px] capitalize ${
                      overlayFit === fit
                        ? 'bg-amber-500/20 text-amber-100'
                        : 'text-gray-400'
                    }`}
                  >
                    {fit}
                  </button>
                ))}
              </div>
            </>
          )}
          {onSwap && (
            <button
              type="button"
              onClick={onSwap}
              className="px-3 py-1.5 rounded-lg text-xs font-medium text-gray-200 bg-white/5 hover:bg-white/10 border border-white/10"
            >
              Swap sides
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="w-9 h-9 rounded-full bg-white/10 hover:bg-white/20 text-white"
            aria-label="Close compare"
          >
            ✕
          </button>
        </div>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-1 md:grid-cols-2 gap-3 p-4">
        <ComparePane asset={left} label="Left / reference" reviewScale={reviewScale} />
        <ComparePane
          asset={right}
          label="Right / generated"
          ghostAsset={ghostEnabled ? left : null}
          ghostOpacity={ghostOpacity}
          overlayFit={overlayFit}
          reviewScale={reviewScale}
        />
      </div>
    </div>
  );
};

const ComparePane: React.FC<{
  asset: StudioAsset;
  label: string;
  ghostAsset?: StudioAsset | null;
  ghostOpacity?: number;
  overlayFit?: 'contain' | 'cover';
  reviewScale: 'fit' | 'actual';
}> = ({
  asset,
  label,
  ghostAsset = null,
  ghostOpacity = 0.3,
  overlayFit = 'contain',
  reviewScale,
}) => (
  <div className="min-h-0 flex flex-col rounded-xl border border-white/10 bg-white/[0.03] overflow-hidden">
    <div className="px-3 py-2 border-b border-white/10 flex items-center justify-between gap-2">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-widest text-gray-500">{label}</p>
        <p className="text-xs font-medium text-white truncate">{asset.name || 'Untitled'}</p>
      </div>
      <span className="text-[10px] text-gray-500 flex-shrink-0 capitalize">{asset.source.replace('_', ' ')}</span>
    </div>
    <ComparePaneImage
      asset={asset}
      label={label}
      ghostAsset={ghostAsset}
      ghostOpacity={ghostOpacity}
      overlayFit={overlayFit}
      reviewScale={reviewScale}
    />
    {asset.generationPrompt && (
      <div className="max-h-24 overflow-y-auto px-3 py-2 border-t border-white/10">
        <p className="text-[10px] text-teal-200 font-semibold mb-1">Prompt</p>
        <p className="text-[11px] text-gray-300 leading-relaxed line-clamp-4">{asset.generationPrompt}</p>
      </div>
    )}
  </div>
);

const ComparePaneImage: React.FC<{
  asset: StudioAsset;
  label: string;
  ghostAsset?: StudioAsset | null;
  ghostOpacity?: number;
  overlayFit?: 'contain' | 'cover';
  reviewScale: 'fit' | 'actual';
}> = ({
  asset,
  label,
  ghostAsset = null,
  ghostOpacity = 0.3,
  overlayFit = 'contain',
  reviewScale,
}) => {
  const assetSrc = resolveStudioAssetSrc(asset);
  const ghostSrc = ghostAsset ? resolveStudioAssetSrc(ghostAsset) : undefined;
  return (
    <div className={`relative flex-1 min-h-0 bg-studio-canvas/40 ${reviewScale === 'actual' ? 'overflow-auto' : 'overflow-hidden'}`}>
      {assetSrc ? (
        <img
          src={assetSrc}
          alt={asset.name || label}
          className={reviewScale === 'fit' ? 'absolute inset-3' : 'block m-3 max-w-none h-auto w-auto'}
          style={reviewScale === 'fit' ? {
            width: 'calc(100% - 1.5rem)',
            height: 'calc(100% - 1.5rem)',
            objectFit: 'contain',
          } : undefined}
        />
      ) : (
        <div className="absolute inset-3 flex items-center justify-center text-xs text-gray-500">
          Preview unavailable
        </div>
      )}
      {ghostAsset && ghostSrc && (
        <img
          src={ghostSrc}
          alt="Ghost reference overlay"
          className="pointer-events-none absolute inset-3"
          style={{
            width: 'calc(100% - 1.5rem)',
            height: 'calc(100% - 1.5rem)',
            opacity: ghostOpacity,
            objectFit: overlayFit,
          }}
        />
      )}
    </div>
  );
};

export default StudioCompareView;
