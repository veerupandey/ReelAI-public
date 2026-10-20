import React from 'react';
import type { CreativeExecutionMode, StrategistBrief } from './types';
import {
  formatCreativeTerritoriesText,
  parseCreativeTerritoriesText,
} from './strategistBriefService';

export interface StrategistBriefPanelProps {
  brief: StrategistBrief;
  stale?: boolean;
  isPolishing?: boolean;
  isRegeneratingConcepts?: boolean;
  onChange: (updates: Partial<StrategistBrief>) => void;
  onPolish?: () => void;
  onRegenerateConcepts?: () => void;
  onExecutionModeChange?: (mode: CreativeExecutionMode) => void;
}

const EXECUTION_MODE_OPTIONS: Array<{ value: CreativeExecutionMode; label: string }> = [
  { value: 'original', label: 'Original' },
  { value: 'recreate', label: 'Recreate' },
  { value: 'hybrid', label: 'Hybrid' },
];

/**
 * Editable Strategist Brief panel — section 1.5 between research and concepts.
 * Parent owns polish / regenerate handlers and stale detection.
 */
const StrategistBriefPanel: React.FC<StrategistBriefPanelProps> = ({
  brief,
  stale = false,
  isPolishing = false,
  isRegeneratingConcepts = false,
  onChange,
  onPolish,
  onRegenerateConcepts,
  onExecutionModeChange,
}) => {
  const busy = isPolishing || isRegeneratingConcepts;

  const handleModeChange = (mode: CreativeExecutionMode) => {
    if (mode === brief.executionMode) return;
    onChange({ executionMode: mode });
    onExecutionModeChange?.(mode);
  };

  const handleTerritoriesChange = (text: string) => {
    onChange({ creativeTerritories: parseCreativeTerritoriesText(text) });
  };

  return (
    <section
      className="space-y-3 rounded-lg border border-studio-accent/30 bg-studio-accent/10 p-3"
      data-testid="strategist-brief-panel"
      aria-label="Strategist Brief"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs uppercase tracking-widest text-teal-200">1.5 Strategist Brief</div>
        <span className="rounded-full border border-studio-accent/40 bg-studio-accent/20 px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide text-teal-50">
          {brief.executionMode}
        </span>
      </div>

      {stale && (
        <div
          className="rounded-md border border-amber-400/30 bg-amber-500/15 px-2.5 py-2 text-[11px] text-amber-100"
          role="status"
        >
          Locked images changed — re-research or regenerate concepts
        </div>
      )}

      <div className="space-y-1.5">
        <label
          htmlFor="strategist-brief-summary"
          className="block text-[10px] uppercase tracking-widest text-studio-mist/80"
        >
          Summary
        </label>
        <textarea
          id="strategist-brief-summary"
          value={brief.summary}
          onChange={(e) => onChange({ summary: e.target.value })}
          rows={4}
          disabled={busy}
          className="w-full rounded-md border border-studio-border bg-studio-surface/80 px-2.5 py-2 text-sm leading-relaxed text-slate-200 placeholder:text-slate-600 focus:border-studio-accent/50 focus:outline-none focus:ring-1 focus:ring-studio-accent/30 disabled:opacity-50"
        />
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] uppercase tracking-widest text-studio-mist/80">Execution mode</div>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Execution mode">
          {EXECUTION_MODE_OPTIONS.map((option) => {
            const selected = brief.executionMode === option.value;
            return (
              <button
                key={option.value}
                type="button"
                disabled={busy}
                aria-pressed={selected}
                onClick={() => handleModeChange(option.value)}
                className={`rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
                  selected
                    ? 'border-studio-accent/60 bg-studio-accent/30 text-teal-50'
                    : 'border-studio-border bg-studio-panel/80 text-studio-mist hover:border-studio-accent/40 hover:text-teal-50'
                }`}
              >
                {option.label}
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="strategist-brief-territories"
          className="block text-[10px] uppercase tracking-widest text-studio-mist/80"
        >
          Creative territories
        </label>
        <textarea
          id="strategist-brief-territories"
          value={formatCreativeTerritoriesText(brief.creativeTerritories)}
          onChange={(e) => handleTerritoriesChange(e.target.value)}
          rows={4}
          disabled={busy}
          placeholder="One territory per line"
          className="w-full rounded-md border border-studio-border bg-studio-surface/80 px-2.5 py-2 text-xs leading-relaxed text-studio-mist placeholder:text-slate-600 focus:border-studio-accent/50 focus:outline-none focus:ring-1 focus:ring-studio-accent/30 disabled:opacity-50"
        />
      </div>

      {(brief.brandFit || brief.productFit) && (
        <div className="space-y-1 text-xs text-studio-mist">
          {brief.brandFit && (
            <p>
              <span className="font-medium text-studio-mist">Brand fit:</span> {brief.brandFit}
            </p>
          )}
          {brief.productFit && (
            <p>
              <span className="font-medium text-studio-mist">Product fit:</span> {brief.productFit}
            </p>
          )}
        </div>
      )}

      {brief.preservationPriorities.length > 0 && (
        <div className="space-y-1.5">
          <div className="text-[10px] uppercase tracking-widest text-studio-mist/80">Preservation</div>
          <div className="flex flex-wrap gap-1.5">
            {brief.preservationPriorities.slice(0, 6).map((item) => (
              <span
                key={item}
                className="rounded-full border border-emerald-400/30 bg-emerald-500/10 px-2 py-0.5 text-[10px] text-emerald-100"
              >
                {item.length > 48 ? `${item.slice(0, 48)}…` : item}
              </span>
            ))}
          </div>
        </div>
      )}

      {brief.openQuestions.length > 0 && (
        <div className="rounded-md border border-amber-400/20 bg-amber-500/10 px-2.5 py-2 text-[11px] text-amber-100">
          <span className="font-medium text-amber-50">Open questions:</span>{' '}
          {brief.openQuestions.slice(0, 3).join(' · ')}
        </div>
      )}

      <div className="flex flex-col gap-2 sm:flex-row">
        {onPolish && (
          <button
            type="button"
            onClick={onPolish}
            disabled={busy}
            className="flex-1 rounded-lg border border-studio-accent/40 bg-studio-panel py-2.5 text-sm font-medium text-teal-100 hover:bg-studio-accent/10 disabled:opacity-40"
          >
            {isPolishing ? 'Polishing…' : 'Polish with AI'}
          </button>
        )}
        {onRegenerateConcepts && (
          <button
            type="button"
            onClick={onRegenerateConcepts}
            disabled={busy}
            className="flex-1 rounded-lg bg-gradient-to-r from-insta-start via-insta-mid to-insta-end py-2.5 text-sm font-semibold text-white disabled:opacity-40"
          >
            {isRegeneratingConcepts ? 'Regenerating…' : 'Regenerate concepts'}
          </button>
        )}
      </div>
    </section>
  );
};

export default StrategistBriefPanel;
