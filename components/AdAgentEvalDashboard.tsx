import React from 'react';
import type { IntelligenceEvalResult } from '../services/adIntelligence/evalRunner';

const LABELS: Record<string, string> = {
  formatAccuracy: 'Format Accuracy',
  intendedUseAccuracy: 'Intended Use',
  supportedClaimPrecision: 'Supported Claims',
  citationCoverage: 'Citation Coverage',
  referenceLimitAccuracy: 'Reference Limits',
};

const AdAgentEvalDashboard: React.FC<{ result: IntelligenceEvalResult }> = ({ result }) => (
  <div className="rounded-2xl border border-dark-border bg-dark-card p-5">
    <div className="flex items-center justify-between">
      <div>
        <p className="text-xs font-semibold uppercase tracking-wider text-emerald-300">Ad Intelligence Evaluation</p>
        <p className="mt-1 text-[10px] text-gray-500">{result.caseCount} golden cases</p>
      </div>
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-5">
      {Object.entries(result.metrics).map(([key, value]) => (
        <div key={key} className="rounded-xl border border-dark-border bg-dark-bg p-3">
          <p className="text-[10px] text-gray-500">{LABELS[key] || key}</p>
          <p className={`mt-1 text-xl font-bold ${value >= .9 ? 'text-emerald-300' : value >= .7 ? 'text-amber-300' : 'text-red-300'}`}>
            {(value * 100).toFixed(0)}%
          </p>
        </div>
      ))}
    </div>
  </div>
);

export default AdAgentEvalDashboard;
