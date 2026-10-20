import React, { useEffect, useState } from 'react';
import type { ProductionBrief } from './productionBriefService';

export interface ProductionBriefPanelProps {
  brief: ProductionBrief;
  /** Persist edits to generationPrompt on the session brief */
  onPromptChange?: (prompt: string) => void;
  /** Apply the current generation prompt into the composer */
  onApplyPrompt: (prompt: string) => void;
  /** Open Prompt Writer seeded with the current generation prompt */
  onDevelopInWriter: (prompt: string) => void;
  onClear?: () => void;
}

/**
 * ProductionBriefPanel — inspectable post-concept brief before Generate / Writer.
 */
const ProductionBriefPanel: React.FC<ProductionBriefPanelProps> = ({
  brief,
  onPromptChange,
  onApplyPrompt,
  onDevelopInWriter,
  onClear,
}) => {
  const [promptDraft, setPromptDraft] = useState(brief.generationPrompt);

  useEffect(() => {
    setPromptDraft(brief.generationPrompt);
  }, [brief.generationPrompt]);

  const handlePromptChange = (value: string) => {
    setPromptDraft(value);
    onPromptChange?.(value);
  };

  return (
    <div
      className="flex flex-col gap-3 p-4 bg-studio-surface/80 border border-emerald-500/30 rounded-xl"
      data-testid="production-brief-panel"
      aria-label="Production Brief"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-2 h-2 rounded-full bg-emerald-400 flex-shrink-0" aria-hidden="true" />
          <h3 className="text-xs uppercase tracking-widest font-semibold text-emerald-300 truncate">
            Production Brief
          </h3>
        </div>
        {onClear && (
          <button
            type="button"
            onClick={onClear}
            className="text-[10px] text-studio-mist/80 hover:text-red-400 transition-colors focus:outline-none focus:ring-1 focus:ring-red-400/30 rounded px-1"
            aria-label="Clear production brief"
          >
            Clear
          </button>
        )}
      </div>

      <p className="text-sm text-slate-200 leading-relaxed">{brief.summary}</p>

      <div>
        <label htmlFor="production-brief-prompt" className="text-xs text-studio-mist/80 mb-1.5 block">
          Generation prompt
        </label>
        <textarea
          id="production-brief-prompt"
          value={promptDraft}
          onChange={(e) => handlePromptChange(e.target.value)}
          rows={8}
          className="w-full rounded-lg border border-studio-border bg-studio-canvas/80 px-3 py-2 text-xs text-studio-ink leading-relaxed resize-y focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
          aria-label="Generation prompt"
        />
      </div>

      {brief.preservationInstructions.length > 0 && (
        <div>
          <p className="text-xs text-studio-mist/80 mb-1.5">Preserve</p>
          <ul className="flex flex-col gap-1" aria-label="Preservation instructions">
            {brief.preservationInstructions.map((item, index) => (
              <li key={`${index}-${item.slice(0, 24)}`} className="flex items-start gap-1.5 text-xs text-cyan-200">
                <span className="text-cyan-500 mt-0.5 flex-shrink-0" aria-hidden="true">
                  •
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      {brief.avoidList.length > 0 && (
        <div>
          <p className="text-xs text-studio-mist/80 mb-1.5">Avoid</p>
          <ul className="flex flex-col gap-1" aria-label="Avoid list">
            {brief.avoidList.map((item, index) => (
              <li key={`${index}-${item.slice(0, 24)}`} className="flex items-start gap-1.5 text-xs text-amber-200/90">
                <span className="text-amber-500 mt-0.5 flex-shrink-0" aria-hidden="true">
                  •
                </span>
                {item}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-wrap gap-2 pt-1">
        <button
          type="button"
          onClick={() => onApplyPrompt(promptDraft)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-emerald-500/20 text-emerald-200 border border-emerald-500/40 hover:bg-emerald-500/30 transition-colors focus:outline-none focus:ring-1 focus:ring-emerald-400/40"
        >
          Apply to composer
        </button>
        <button
          type="button"
          onClick={() => onDevelopInWriter(promptDraft)}
          className="px-3 py-1.5 rounded-lg text-xs font-medium bg-studio-panel text-studio-ink border border-studio-border hover:bg-studio-panel transition-colors focus:outline-none focus:ring-1 focus:ring-slate-400/40"
        >
          Develop in Writer
        </button>
      </div>
    </div>
  );
};

export default ProductionBriefPanel;
