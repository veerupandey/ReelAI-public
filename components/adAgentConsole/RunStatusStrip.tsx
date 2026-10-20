import React from 'react';
import type { AgentEvent } from '../../services/autonomousAgent';
import { GoalProgressDots, type GoalProgress } from './GoalProgressDots';

export const SidebarRunStatus: React.FC<{
  isRunning: boolean;
  phaseLabel: string;
  latestStatus: string;
  showDetails: boolean;
  statusLog: AgentEvent[];
  goalProgress?: GoalProgress | null;
  showGoalProgress?: boolean;
  isBrowsing?: boolean;
}> = ({
  isRunning,
  phaseLabel,
  latestStatus,
  showDetails,
  statusLog,
  goalProgress,
  showGoalProgress,
  isBrowsing,
}) => {
  if (!isRunning && !latestStatus) return null;
  return (
    <div className="border-t border-dark-border p-3">
      <div className="flex items-center justify-between gap-2 mb-1">
        <p className="text-[10px] uppercase tracking-wider text-gray-600">Run status</p>
        {showGoalProgress && goalProgress ? <GoalProgressDots progress={goalProgress} /> : null}
      </div>
      <p className="text-[11px] text-gray-300 leading-snug">
        {isRunning ? (
          <>
            <span className="text-emerald-400 font-medium">{phaseLabel}</span>
            {isBrowsing ? <span className="text-cyan-400/80"> · Browsing</span> : null}
            {latestStatus ? <span className="text-gray-500"> · {latestStatus}</span> : null}
          </>
        ) : (
          latestStatus || 'Idle'
        )}
      </p>
      {showDetails && statusLog.length > 1 && (
        <div className="mt-2 max-h-28 overflow-y-auto space-y-0.5">
          {statusLog.slice(-20).map((e) => (
            <p key={e.id} className="text-[10px] text-gray-600 leading-snug">{e.message}</p>
          ))}
        </div>
      )}
    </div>
  );
};

export const StickyRunStatus: React.FC<{
  pendingApproval: boolean;
  phaseLabel: string;
  latestStatus: string;
  approvalQuestion?: string;
  showDetails: boolean;
  onToggleDetails: () => void;
  goalProgress?: GoalProgress | null;
  showGoalProgress?: boolean;
  isBrowsing?: boolean;
}> = ({
  pendingApproval,
  phaseLabel,
  latestStatus,
  approvalQuestion,
  showDetails,
  onToggleDetails,
  goalProgress,
  showGoalProgress,
  isBrowsing,
}) => (
  <div className="sticky top-0 z-10 -mx-1 px-4 py-2.5 rounded-xl bg-dark-card/95 border border-dark-border backdrop-blur-sm flex items-center gap-3">
    <span className={`w-2 h-2 rounded-full flex-shrink-0 ${pendingApproval ? 'bg-amber-400' : isBrowsing ? 'bg-cyan-400 animate-pulse' : 'bg-emerald-400 animate-pulse'}`} />
    <div className="min-w-0 flex-1">
      <div className="flex items-center gap-2">
        <p className="text-xs font-semibold text-white truncate">
          {pendingApproval ? 'Needs your approval' : isBrowsing ? 'Browsing' : phaseLabel}
        </p>
        {showGoalProgress && goalProgress ? <GoalProgressDots progress={goalProgress} /> : null}
      </div>
      <p className="text-[10px] text-gray-500 truncate">
        {pendingApproval
          ? (approvalQuestion || 'Review and continue')
          : (latestStatus || 'Working…')}
      </p>
    </div>
    <button
      type="button"
      onClick={onToggleDetails}
      className="text-[10px] text-gray-500 hover:text-gray-300 flex-shrink-0"
    >
      {showDetails ? 'Hide details' : 'Details'}
    </button>
  </div>
);
