import React from 'react';

export type GoalProgress = {
  passed: number;
  total: number;
  skillPath?: string;
};

/** Compact checklist dots for recreate / Details run status. */
export const GoalProgressDots: React.FC<{ progress: GoalProgress }> = ({ progress }) => {
  const { passed, total } = progress;
  if (total <= 0) return null;
  return (
    <div className="flex items-center gap-1.5" title={`${passed}/${total} checks`}>
      <div className="flex items-center gap-0.5">
        {Array.from({ length: total }, (_, i) => (
          <span
            key={i}
            className={`w-1.5 h-1.5 rounded-full ${
              i < passed ? 'bg-emerald-400' : 'bg-white/15'
            }`}
          />
        ))}
      </div>
      <span className="text-[10px] text-gray-500 tabular-nums">
        {passed}/{total}
      </span>
    </div>
  );
};
