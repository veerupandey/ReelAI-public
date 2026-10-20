/**
 * VariationSetScorecardPanel — set-level brand compliance summary in lightbox.
 */

import React from 'react';
import type { StudioAsset } from './types';
import { buildVariationSetScorecard } from './variationSetScorecard';

export interface VariationSetScorecardPanelProps {
  assets: StudioAsset[];
  variationSetId: string;
  activeAssetId?: string;
  onSelectAsset?: (assetId: string) => void;
}

const VariationSetScorecardPanel: React.FC<VariationSetScorecardPanelProps> = ({
  assets,
  variationSetId,
  activeAssetId,
  onSelectAsset,
}) => {
  const scorecard = buildVariationSetScorecard(assets, variationSetId);
  if (!scorecard) return null;

  const labelFor = (id: string | null) => {
    if (!id) return '—';
    const asset = assets.find((a) => a.id === id);
    return asset?.name?.slice(0, 24) || id.slice(0, 8);
  };

  return (
    <div
      className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-3 space-y-2"
      data-testid="variation-set-scorecard"
    >
      <div className="flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-wider text-emerald-300">
          Variation set scorecard
        </p>
        <p className="text-[11px] text-emerald-100">
          {scorecard.averageScore != null ? `${scorecard.averageScore}/100 avg` : 'Pending scores'}
        </p>
      </div>
      <div className="grid grid-cols-3 gap-2 text-[10px] text-gray-300">
        <div>
          <div className="text-gray-500">Assets</div>
          <div className="text-white font-medium">{scorecard.assetCount}</div>
        </div>
        <div>
          <div className="text-gray-500">Pass / Warn / Fail</div>
          <div className="text-white font-medium">
            {scorecard.passCount}/{scorecard.warningCount}/{scorecard.failCount}
          </div>
        </div>
        <div>
          <div className="text-gray-500">Pending</div>
          <div className="text-white font-medium">{scorecard.pendingCount}</div>
        </div>
      </div>
      <div className="text-[11px] text-gray-300 space-y-1">
        <div>
          Best:{' '}
          <button
            type="button"
            className={`underline-offset-2 ${scorecard.bestAssetId === activeAssetId ? 'text-emerald-200' : 'text-emerald-300 hover:underline'}`}
            disabled={!scorecard.bestAssetId || !onSelectAsset}
            onClick={() => scorecard.bestAssetId && onSelectAsset?.(scorecard.bestAssetId)}
          >
            {labelFor(scorecard.bestAssetId)}
          </button>
        </div>
        <div>
          Recommended:{' '}
          <button
            type="button"
            className={`underline-offset-2 ${scorecard.recommendedWinnerId === activeAssetId ? 'text-emerald-200' : 'text-emerald-300 hover:underline'}`}
            disabled={!scorecard.recommendedWinnerId || !onSelectAsset}
            onClick={() =>
              scorecard.recommendedWinnerId && onSelectAsset?.(scorecard.recommendedWinnerId)
            }
          >
            {labelFor(scorecard.recommendedWinnerId)}
          </button>
        </div>
      </div>
      {scorecard.categoryAverages.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {scorecard.categoryAverages.map((row) => (
            <span
              key={row.category}
              className="rounded-full border border-emerald-500/20 px-2 py-0.5 text-[10px] text-emerald-100"
            >
              {row.category}: {row.average}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export default VariationSetScorecardPanel;
