import React from 'react';
import type { ExecutionMode, PlannedStoryboardScene } from '../../types/brand';
import type { AgencySuggestedTrim } from './productLockTypes';

interface Props {
  executionMode: ExecutionMode;
  agencySuggestedScenes: PlannedStoryboardScene[];
  isRunningAgencyAutopilot: boolean;
  onRunAgencyAutopilot: () => void;
  onAcceptAgencySuggestedScene: (ideaId: string) => void;
  sceneIdeaPrompt: string;
  setSceneIdeaPrompt: (value: string) => void;
  isAddingSceneIdea: boolean;
  onAddSceneIdea: (useAI: boolean) => void;
  agencySuggestedTrims: AgencySuggestedTrim[];
  onApplyAgencyTrim: (sceneId: string) => void;
  narrativeArc?: string;
  creativeRationale?: string;
}

const ProductLockSceneExpansionPanel: React.FC<Props> = ({
  executionMode,
  agencySuggestedScenes,
  isRunningAgencyAutopilot,
  onRunAgencyAutopilot,
  onAcceptAgencySuggestedScene,
  sceneIdeaPrompt,
  setSceneIdeaPrompt,
  isAddingSceneIdea,
  onAddSceneIdea,
  agencySuggestedTrims,
  onApplyAgencyTrim,
  narrativeArc,
  creativeRationale,
}) => {
  return (
    <div className="rounded-2xl border border-dark-border bg-dark-bg p-5 space-y-4">
      {executionMode === 'agency' && (narrativeArc || creativeRationale) && (
        <div className="mb-6 rounded-2xl border-2 border-purple-500/30 bg-gradient-to-br from-purple-900/40 via-dark-card to-pink-900/20 p-6 relative overflow-hidden group shadow-2xl shadow-purple-500/10">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <svg className="w-24 h-24 text-white" fill="currentColor" viewBox="0 0 24 24">
              <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-2 15l-5-5 1.41-1.41L10 14.17l7.59-7.59L19 8l-9 9z" />
            </svg>
          </div>
          
          <div className="relative z-10">
            <div className="flex items-center gap-3 mb-4">
              <div className="w-10 h-10 rounded-xl bg-purple-500/20 flex items-center justify-center text-xl shadow-lg shadow-purple-500/20 border border-purple-500/30">
                ✨
              </div>
              <div>
                <p className="text-[10px] uppercase tracking-widest text-purple-300 font-bold">Premium Agency Vision</p>
                <h4 className="text-lg font-bold text-transparent bg-clip-text bg-gradient-to-r from-white to-purple-200">The Story-First Narrative</h4>
              </div>
            </div>

            {narrativeArc && (
              <div className="space-y-2 mb-4">
                <p className="text-[11px] uppercase tracking-wider text-purple-400/80 font-semibold mb-1">Narrative Arc</p>
                <p className="text-sm text-gray-200 leading-relaxed italic border-l-2 border-purple-500/40 pl-4 py-1">
                  "{narrativeArc}"
                </p>
              </div>
            )}

            {creativeRationale && (
              <div className="space-y-2">
                <p className="text-[11px] uppercase tracking-wider text-pink-400/80 font-semibold mb-1">Creative Rationale</p>
                <p className="text-[12px] text-gray-400 leading-relaxed font-medium">
                  {creativeRationale}
                </p>
              </div>
            )}
          </div>
        </div>
      )}

      <div>
        <p className="text-xs uppercase tracking-wider text-gray-500 mb-2">3. Add More Scenes</p>
        <h4 className="text-lg font-semibold text-white">Expand the storyboard only when needed</h4>
        <p className="text-sm text-gray-400 mt-1">
          The first storyboard is already created. Use this only to add missing beats, proof shots, or alternate story angles.
        </p>
      </div>
      {executionMode === 'agency' && (
        <div className="rounded-xl border border-fuchsia-500/20 bg-fuchsia-500/10 p-4 space-y-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-[10px] uppercase tracking-wider text-fuchsia-200">Agency Autopilot</p>
              <p className="mt-1 text-sm text-white">
                Deep mode researches scene gaps in parallel, recommends which imported asset to build from, and proposes extra optional scenes.
              </p>
            </div>
            <button
              onClick={onRunAgencyAutopilot}
              disabled={isRunningAgencyAutopilot}
              className="px-3 py-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/15 text-[11px] font-semibold text-fuchsia-100 disabled:opacity-50"
            >
              {isRunningAgencyAutopilot ? 'Researching...' : 'Refresh Agency Suggestions'}
            </button>
          </div>
          {agencySuggestedScenes.length > 0 && (
            <div className="space-y-3">
              {agencySuggestedScenes.map((idea) => (
                <div key={idea.id} className="rounded-lg border border-white/10 bg-black/20 p-3">
                  <p className="text-[11px] uppercase tracking-wider text-fuchsia-200">Suggested scene #{idea.suggestedPosition}</p>
                  <p className="mt-1 text-sm font-medium text-white">{idea.text}</p>
                  <p className="mt-2 text-[12px] text-gray-300">{idea.visualDescription}</p>
                  <p className="mt-2 text-[12px] text-gray-400">Prompt: {idea.imagePrompt}</p>
                  <button
                    onClick={() => onAcceptAgencySuggestedScene(idea.id)}
                    className="mt-3 px-3 py-1.5 rounded-lg border border-fuchsia-500/30 bg-fuchsia-500/15 text-[11px] font-semibold text-fuchsia-100"
                  >
                    Add To Scene Plan
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
      
      {executionMode === 'agency' && agencySuggestedTrims && agencySuggestedTrims.length > 0 && (
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 p-4 space-y-3 mt-4">
          <div className="flex items-center gap-2">
            <svg className="w-4 h-4 text-rose-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
            </svg>
            <p className="text-[10px] uppercase tracking-wider text-rose-200">Recommended Trims</p>
          </div>
          <div className="space-y-3">
            {agencySuggestedTrims.map((trim) => (
              <div key={trim.sceneIdToRemove} className="rounded-lg border border-rose-500/10 bg-black/20 p-3">
                <p className="text-sm font-medium text-rose-100">{trim.reasoning}</p>
                <button
                  onClick={() => onApplyAgencyTrim(trim.sceneIdToRemove)}
                  className="mt-3 px-3 py-1.5 rounded-lg border border-rose-500/30 bg-rose-500/15 text-[11px] font-semibold text-rose-100 hover:bg-rose-500/25 transition-colors"
                >
                  Apply Trim (Remove Scene)
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
      <textarea
        value={sceneIdeaPrompt}
        onChange={(e) => setSceneIdeaPrompt(e.target.value)}
        placeholder="e.g. Show a tighter product hero with the serum texture on skin, then a proof scene with benefit focus"
        className="w-full min-h-[110px] rounded-xl border border-dark-border bg-black/30 px-4 py-3 text-sm text-white outline-none"
      />
      {!(sceneIdeaPrompt || '').trim() && !isAddingSceneIdea && (
        <p className="text-xs text-gray-500 italic mt-1 ml-1">Type your scene idea or let the AI suggest one contextually.</p>
      )}
      <div className="flex flex-wrap gap-3">
        <button
          onClick={() => onAddSceneIdea(true)}
          disabled={isAddingSceneIdea}
          className="px-4 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-semibold disabled:opacity-50"
        >
          {isAddingSceneIdea ? 'Thinking...' : 'AI Suggest Scene'}
        </button>
        <button
          onClick={() => onAddSceneIdea(false)}
          disabled={isAddingSceneIdea || !(sceneIdeaPrompt || '').trim()}
          className="px-4 py-2.5 rounded-xl bg-dark-card border border-dark-border text-gray-200 font-semibold disabled:opacity-50"
        >
          Add Manual Scene
        </button>
      </div>
      <div className="rounded-xl border border-dark-border bg-dark-card p-4">
        <p className="text-sm text-gray-300">
          New scenes will appear in the scene plan above, where you can assign their required base image and generate scene-specific assets.
        </p>
      </div>
    </div>
  );
};

export default ProductLockSceneExpansionPanel;
