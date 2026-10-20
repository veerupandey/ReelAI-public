import React from 'react';
import type { ProductResolutionCandidate } from '../../types/brand';

interface Props {
  candidates: ProductResolutionCandidate[];
  renderCandidatePreview: (candidate: ProductResolutionCandidate) => React.ReactNode;
  onBack: () => void;
}

const ProductLockCandidateSelectionPanel: React.FC<Props> = ({
  candidates,
  renderCandidatePreview,
  onBack,
}) => {
  const hasExplicitUrlCandidates = candidates.some((candidate) => candidate.source === 'explicit_url');
  return (
    <div className="space-y-4">
      <div className="rounded-2xl border border-dark-border bg-dark-card p-6">
        <p className="text-white font-semibold flex items-center gap-2">
          <span className="text-orange-400">⚠️</span> Multiple matches found
        </p>
        <p className="text-sm text-gray-400 mt-2 leading-relaxed">
          {hasExplicitUrlCandidates
            ? 'Your brief included multiple product URLs. Select the exact product you want to build this campaign around to continue.'
            : 'Your brief matched multiple products in the database. Please select the exact product you want to build this campaign around to continue.'}
        </p>
      </div>
      {candidates.length > 0 ? candidates.map(renderCandidatePreview) : (
        <div className="rounded-2xl border border-dark-border bg-dark-card p-8 text-center">
          <div className="text-4xl mb-3 opacity-50">🔍</div>
          <p className="text-white font-medium">No product candidates found</p>
          <p className="text-sm text-gray-400 mt-2 max-w-sm mx-auto">
            Try editing your brief to include a more specific product URL, or go back and paste a direct product page link.
          </p>
        </div>
      )}
      <div className="flex justify-start">
        <button
          onClick={onBack}
          className="px-5 py-3 rounded-xl bg-dark-bg border border-dark-border text-gray-300"
        >
          Back to Brief
        </button>
      </div>
    </div>
  );
};

export default ProductLockCandidateSelectionPanel;
