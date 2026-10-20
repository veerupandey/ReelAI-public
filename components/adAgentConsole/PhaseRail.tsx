import React from 'react';
import type { AgentPhase } from '../../services/autonomousAgent';

export type PhaseRailItem = { key: AgentPhase; label: string; icon: string };

export const PhaseRail: React.FC<{
  phases: PhaseRailItem[];
  currentPhase: AgentPhase;
  completedPhases: Set<AgentPhase>;
  isRunning: boolean;
  pendingApproval: boolean;
}> = ({ phases, currentPhase, completedPhases, isRunning, pendingApproval }) => (
  <div className="flex-1 p-4 space-y-1.5">
    <p className="text-[10px] uppercase tracking-wider text-gray-600 mb-3">Pipeline</p>
    {phases.map(({ key, label, icon }) => {
      const isActive = currentPhase === key && isRunning;
      const isPaused = currentPhase === key && pendingApproval;
      const isDone = completedPhases.has(key);
      return (
        <div
          key={key}
          className={`flex items-center gap-2.5 px-3 py-2 rounded-lg transition-all ${
            isPaused ? 'bg-amber-500/15 border border-amber-500/40'
              : isActive ? 'bg-emerald-500/15 border border-emerald-500/30'
                : isDone ? 'border border-transparent opacity-50'
                  : 'border border-transparent opacity-20'
          }`}
        >
          <span className="text-sm">
            {isPaused ? '⏸' : isDone ? '✓' : isActive ? <span className="inline-block animate-pulse">{icon}</span> : icon}
          </span>
          <span className={`text-xs font-medium ${
            isPaused ? 'text-amber-300' : isActive ? 'text-emerald-300' : isDone ? 'text-gray-400' : 'text-gray-600'
          }`}>
            {label}
          </span>
          {(isActive || isPaused) && (
            <span className={`ml-auto w-1.5 h-1.5 rounded-full ${isPaused ? 'bg-amber-400' : 'bg-emerald-400 animate-pulse'}`} />
          )}
        </div>
      );
    })}
  </div>
);
