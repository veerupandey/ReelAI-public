import React, { useState } from 'react';
import type { ProductTruth, StudioAsset } from './types';

export interface ProductTruthPanelProps {
  productTruth: ProductTruth;
  assets: StudioAsset[];
  onAddCorrection: (correction: string) => void;
  onRemoveAsset: (assetId: string) => void;
  onClear: () => void;
  /** Start collapsed so Prompt / Writer stay visible in the side column. */
  defaultCollapsed?: boolean;
}

/**
 * ProductTruthPanel — shows the persistent product identity record.
 *
 * Displays:
 * - Protected assets (thumbnails)
 * - Preservation rules (cyan — protected)
 * - Verified facts
 * - Unresolved questions (amber — needs confirmation)
 * - User corrections
 * - Add correction input
 *
 * Replaces all "Locked as Context" language.
 */
const ProductTruthPanel: React.FC<ProductTruthPanelProps> = ({
  productTruth,
  assets,
  onAddCorrection,
  onRemoveAsset,
  onClear,
  defaultCollapsed = true,
}) => {
  const [correctionInput, setCorrectionInput] = useState('');
  const [showCorrections, setShowCorrections] = useState(false);
  const [expanded, setExpanded] = useState(!defaultCollapsed);

  const protectedAssets = assets.filter((a) =>
    productTruth.protectedAssetIds.includes(a.id),
  );

  const ruleCount = productTruth.preservationRules.length;
  const confirmCount = productTruth.unresolvedQuestions.length;
  const factCount = productTruth.verifiedFacts.length;

  const handleAddCorrection = () => {
    const trimmed = correctionInput.trim();
    if (!trimmed) return;
    onAddCorrection(trimmed);
    setCorrectionInput('');
  };

  return (
    <div
      className="flex flex-col gap-3 p-3.5 bg-studio-surface/95 border border-studio-border rounded-xl shadow-sm shadow-black/15"
      data-testid="product-truth-panel"
      aria-label="Product Truth"
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="flex min-w-0 flex-1 items-center gap-2 text-left focus:outline-none focus:ring-1 focus:ring-studio-accent/40 rounded"
          aria-expanded={expanded}
          aria-controls="product-truth-body"
        >
          <div className="w-1.5 h-1.5 rounded-full bg-studio-accent flex-shrink-0" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <h3 className="text-[10px] uppercase tracking-[0.14em] font-semibold text-studio-mist">
              Product Truth
            </h3>
            <p className="truncate text-xs text-studio-ink/90 mt-0.5">
              {productTruth.productName}
            </p>
            {!expanded && (
              <p className="text-[10px] text-studio-mist/70 mt-0.5">
                {ruleCount} preserve · {confirmCount} confirm · {factCount} fact{factCount !== 1 ? 's' : ''}
              </p>
            )}
          </div>
          <svg
            className={`w-3.5 h-3.5 flex-shrink-0 text-studio-mist transition-transform ${expanded ? 'rotate-180' : ''}`}
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
            strokeWidth={2}
            aria-hidden="true"
          >
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        <button
          type="button"
          onClick={onClear}
          className="text-[10px] text-studio-mist/70 hover:text-red-300 transition-colors focus:outline-none focus:ring-1 focus:ring-red-400/30 rounded px-1 flex-shrink-0"
          aria-label="Clear product truth"
        >
          Clear
        </button>
      </div>

      {expanded && (
        <div id="product-truth-body" className="flex flex-col gap-3 max-h-[40vh] overflow-y-auto pr-0.5">
          {/* Protected asset thumbnails */}
          {protectedAssets.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-2">Protected assets</p>
              <div className="flex flex-wrap gap-1.5">
                {protectedAssets.map((asset) => (
                  <div key={asset.id} className="relative group">
                    <div className="w-10 h-10 rounded-md overflow-hidden border border-cyan-500/40">
                      <img
                        src={`data:${asset.mimeType};base64,${asset.base64}`}
                        alt={asset.name}
                        className="w-full h-full object-cover"
                      />
                    </div>
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(asset.id)}
                      className="absolute -top-1 -right-1 w-4 h-4 rounded-full bg-studio-surface border border-studio-border text-gray-400 hover:text-red-400 transition-colors opacity-0 group-hover:opacity-100 focus:outline-none focus:opacity-100 flex items-center justify-center"
                      aria-label={`Remove ${asset.name} from protected assets`}
                    >
                      <svg className="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                      </svg>
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Preservation rules */}
          {productTruth.preservationRules.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Preservation rules</p>
              <ul className="flex flex-col gap-1" aria-label="Preservation rules">
                {productTruth.preservationRules.map((rule, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-cyan-200">
                    <svg className="w-3 h-3 text-cyan-500 flex-shrink-0 mt-0.5" fill="currentColor" viewBox="0 0 20 20">
                      <path fillRule="evenodd" d="M16.707 5.293a1 1 0 010 1.414l-8 8a1 1 0 01-1.414 0l-4-4a1 1 0 011.414-1.414L8 12.586l7.293-7.293a1 1 0 011.414 0z" clipRule="evenodd" />
                    </svg>
                    {rule}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Unresolved questions */}
          {productTruth.unresolvedQuestions.length > 0 && (
            <div>
              <p className="text-xs text-gray-500 mb-1.5">Confirm these</p>
              <ul className="flex flex-col gap-1" aria-label="Unresolved questions">
                {productTruth.unresolvedQuestions.map((q, i) => (
                  <li key={i} className="flex items-start gap-1.5 text-xs text-amber-300">
                    <svg className="w-3 h-3 text-amber-500 flex-shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                    </svg>
                    {q}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Verified facts (collapsed by default) */}
          {productTruth.verifiedFacts.length > 0 && (
            <details className="text-xs">
              <summary className="cursor-pointer text-gray-500 hover:text-gray-300 transition-colors focus:outline-none">
                {productTruth.verifiedFacts.length} verified fact{productTruth.verifiedFacts.length !== 1 ? 's' : ''}
              </summary>
              <ul className="mt-1.5 flex flex-col gap-1 pl-2">
                {productTruth.verifiedFacts.map((fact, i) => (
                  <li key={i} className="text-gray-400">{fact}</li>
                ))}
              </ul>
            </details>
          )}

          {/* User corrections */}
          {productTruth.userCorrections.length > 0 && (
            <div>
              <button
                type="button"
                onClick={() => setShowCorrections((v) => !v)}
                className="text-xs text-gray-500 hover:text-gray-300 transition-colors focus:outline-none"
                aria-expanded={showCorrections}
              >
                {productTruth.userCorrections.length} correction{productTruth.userCorrections.length !== 1 ? 's' : ''} {showCorrections ? '▴' : '▾'}
              </button>
              {showCorrections && (
                <ul className="mt-1.5 flex flex-col gap-1 pl-2">
                  {productTruth.userCorrections.map((c, i) => (
                    <li key={i} className="text-xs text-gray-400">✎ {c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {/* Add correction */}
          <div className="flex gap-2">
            <input
              type="text"
              value={correctionInput}
              onChange={(e) => setCorrectionInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleAddCorrection(); }}
              placeholder="Add a correction or note…"
              maxLength={200}
              className="flex-1 px-2 py-1.5 bg-studio-canvas/20 border border-studio-border rounded-lg text-xs text-white placeholder-gray-600 focus:outline-none focus:ring-1 focus:ring-cyan-500/40"
              aria-label="Add correction"
            />
            <button
              type="button"
              onClick={handleAddCorrection}
              disabled={!correctionInput.trim()}
              className="px-2.5 py-1.5 rounded-lg bg-cyan-500/20 border border-cyan-500/40 text-cyan-300 text-xs font-medium hover:bg-cyan-500/30 transition-colors focus:outline-none focus:ring-1 focus:ring-cyan-500/40 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Submit correction"
            >
              Add
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default ProductTruthPanel;
