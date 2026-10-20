import React from 'react';
import type { McpServerInfo } from '../../services/mcpClient';

export const ConsoleHeader: React.FC<{
  onBack: () => void;
  subtitle: string;
  shellServerOk: boolean | null;
  siliconflowOk: boolean | null;
  mcpServers: McpServerInfo[];
  showDetails: boolean;
  onToggleDetails: () => void;
  showMemoryPanel: boolean;
  onToggleMemory: () => void;
  showEvalDashboard: boolean;
  onToggleEvals: () => void;
  isRunning: boolean;
  onStop: () => void;
  hubBadge?: string | null;
  agencyBadge?: string | null;
}> = ({
  onBack,
  subtitle,
  shellServerOk,
  siliconflowOk,
  mcpServers,
  showDetails,
  onToggleDetails,
  showMemoryPanel,
  onToggleMemory,
  showEvalDashboard,
  onToggleEvals,
  isRunning,
  onStop,
  hubBadge,
  agencyBadge,
}) => (
  <div className="sticky top-0 z-50 backdrop-blur-xl bg-dark-bg/90 border-b border-dark-border">
    <div className="max-w-[1800px] mx-auto px-4 py-3 flex items-center justify-between">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-gray-400 hover:text-white transition-colors text-sm"
        >
          ← Back
        </button>
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-emerald-500 to-cyan-500 flex items-center justify-center text-lg">🤖</div>
        <div>
          <h1 className="text-base font-bold text-white leading-tight">Autonomous Ad Agent</h1>
          <p className="text-[10px] text-gray-500">{subtitle}</p>
        </div>
      </div>
      <div className="flex items-center gap-2">
        {hubBadge && (
          <div className="text-[10px] px-2.5 py-1 rounded-lg border text-teal-300 bg-teal-500/10 border-teal-500/30">
            {hubBadge}
          </div>
        )}
        {agencyBadge && (
          <div className="text-[10px] px-2.5 py-1 rounded-lg border text-purple-300 bg-purple-500/10 border-purple-500/30">
            {agencyBadge}
          </div>
        )}
        <div className={`text-[10px] px-2.5 py-1 rounded-lg border ${shellServerOk ? 'text-emerald-400 bg-emerald-400/10 border-emerald-400/20' : 'text-amber-400 bg-amber-400/10 border-amber-400/20'}`}>
          {shellServerOk ? 'Ready' : 'Setup needed'}
        </div>
        {showDetails && shellServerOk && (
          <div className={`text-[10px] px-2.5 py-1 rounded-lg border ${siliconflowOk ? 'text-cyan-300 bg-cyan-500/10 border-cyan-500/30' : 'text-gray-400 bg-white/5 border-white/10'}`}>
            {siliconflowOk ? 'SiliconFlow ready' : 'SiliconFlow off'}
          </div>
        )}
        {showDetails && mcpServers.filter((s) => s.status === 'connected').map((s) => (
          <div key={s.name} title={`${s.toolCount} tools: ${s.tools.map((t) => t.name).join(', ')}`}
            className="text-[10px] px-2.5 py-1 rounded-lg border text-cyan-400 bg-cyan-400/10 border-cyan-400/20 cursor-default">
            MCP · {s.name} ({s.toolCount})
          </div>
        ))}
        <button
          onClick={onToggleDetails}
          title="Show technical logs, tool dumps, and loop internals"
          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${showDetails ? 'bg-white/10 border-white/25 text-white' : 'bg-dark-card border-dark-border text-gray-400 hover:text-white hover:border-white/20'}`}>
          Details {showDetails ? 'on' : 'off'}
        </button>
        <button
          onClick={onToggleMemory}
          title="Teach the agent from past mistakes"
          className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${showMemoryPanel ? 'bg-purple-500/20 border-purple-500/40 text-purple-300' : 'bg-dark-card border-dark-border text-gray-400 hover:text-purple-300 hover:border-purple-500/40'}`}>
          🧠 Agent Memory
        </button>
        {showDetails && (
          <button
            onClick={onToggleEvals}
            className={`px-3 py-1.5 rounded-lg border text-xs font-semibold transition-all ${showEvalDashboard ? 'bg-emerald-500/20 border-emerald-500/40 text-emerald-300' : 'bg-dark-card border-dark-border text-gray-400 hover:text-emerald-300 hover:border-emerald-500/40'}`}>
            Intelligence Evals
          </button>
        )}
        {isRunning && (
          <button onClick={onStop}
            className="px-3 py-1.5 rounded-lg bg-red-500/20 border border-red-500/40 text-red-300 text-xs font-semibold hover:bg-red-500/30">
            Stop
          </button>
        )}
      </div>
    </div>
  </div>
);
