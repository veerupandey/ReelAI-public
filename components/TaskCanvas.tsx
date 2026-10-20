/**
 * TaskCanvas — real-time visual checklist of planner tasks.
 * Shows each task with status (pending/running/done/failed),
 * assigned worker, tools used, and completion time.
 */

import React, { useEffect, useState } from 'react';
import {
  getTaskCanvas,
  onTaskCanvasChange,
  type TaskItem,
} from '../services/agentMemoryStore';

interface Props {
  className?: string;
}

const statusConfig = {
  pending: { icon: '○', color: 'text-gray-600', bg: '', label: 'Pending' },
  running: { icon: '◉', color: 'text-emerald-400', bg: 'bg-emerald-500/5', label: 'Running' },
  done: { icon: '✓', color: 'text-emerald-500', bg: '', label: 'Done' },
  failed: { icon: '✗', color: 'text-red-400', bg: 'bg-red-500/5', label: 'Failed' },
  skipped: { icon: '–', color: 'text-gray-500', bg: '', label: 'Skipped' },
};

function formatDuration(start?: number, end?: number): string {
  if (!start) return '';
  const elapsed = (end || Date.now()) - start;
  const sec = Math.round(elapsed / 1000);
  if (sec < 60) return `${sec}s`;
  return `${Math.floor(sec / 60)}m ${sec % 60}s`;
}

const TaskCanvas: React.FC<Props> = ({ className }) => {
  const [tasks, setTasks] = useState<TaskItem[]>(getTaskCanvas());

  useEffect(() => {
    const unsub = onTaskCanvasChange(setTasks);
    return unsub;
  }, []);

  if (tasks.length === 0) return null;

  const done = tasks.filter((t) => t.status === 'done').length;
  const total = tasks.length;
  const progress = total > 0 ? Math.round((done / total) * 100) : 0;

  return (
    <div className={`rounded-xl border border-white/[0.06] bg-[#111827] overflow-hidden ${className || ''}`}>
      {/* Header with progress bar */}
      <div className="px-4 pt-3 pb-2">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[10px] font-medium text-gray-500 uppercase tracking-wider">Tasks</span>
          <span className="text-[10px] text-gray-500">{done}/{total}</span>
        </div>
        <div className="h-1 rounded-full bg-gray-800 overflow-hidden">
          <div
            className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-500"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Task list */}
      <div className="px-3 pb-3 space-y-0.5">
        {tasks.map((task) => {
          const cfg = statusConfig[task.status];
          return (
            <div
              key={task.id}
              className={`flex items-start gap-2.5 px-2 py-2 rounded-lg transition-all ${cfg.bg} ${
                task.status === 'running' ? 'border border-emerald-500/20' : ''
              }`}
            >
              {/* Status icon */}
              <span className={`mt-0.5 text-[12px] font-bold shrink-0 ${cfg.color} ${
                task.status === 'running' ? 'animate-pulse' : ''
              }`}>
                {cfg.icon}
              </span>

              {/* Content */}
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className={`text-[12px] truncate ${
                    task.status === 'done' ? 'text-gray-400' :
                    task.status === 'running' ? 'text-emerald-200 font-medium' :
                    task.status === 'failed' ? 'text-red-300' : 'text-gray-500'
                  }`}>
                    {task.title}
                  </span>
                  {task.phase && (
                    <span className="text-[9px] px-1.5 py-0.5 rounded bg-white/[0.03] text-gray-600 shrink-0">
                      {task.phase}
                    </span>
                  )}
                </div>

                {/* Running: show elapsed time */}
                {task.status === 'running' && task.startedAt && (
                  <p className="text-[10px] text-emerald-400/60 mt-0.5">
                    {formatDuration(task.startedAt)} elapsed
                  </p>
                )}

                {/* Done: show result summary + duration */}
                {task.status === 'done' && (
                  <div className="flex items-center gap-2 mt-0.5">
                    {task.result && (
                      <p className="text-[10px] text-gray-600 truncate">{task.result}</p>
                    )}
                    {task.startedAt && task.completedAt && (
                      <span className="text-[9px] text-gray-600 shrink-0">
                        {formatDuration(task.startedAt, task.completedAt)}
                      </span>
                    )}
                  </div>
                )}

                {/* Failed: show error */}
                {task.status === 'failed' && task.result && (
                  <p className="text-[10px] text-red-400/70 mt-0.5 truncate">{task.result}</p>
                )}

                {/* Tools used */}
                {task.status === 'done' && task.tools && task.tools.length > 0 && (
                  <div className="flex gap-1 mt-1 flex-wrap">
                    {[...new Set(task.tools)].slice(0, 4).map((tool) => (
                      <span key={tool} className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-500/5 text-emerald-500/60 border border-emerald-500/10">
                        {tool}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};

export default TaskCanvas;
