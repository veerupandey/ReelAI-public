import React from 'react';

interface ActiveGenerationJob {
  ideaId: string;
  sceneNumber: number;
  text: string;
  assetIndex: number | null;
}

interface Props {
  jobs: ActiveGenerationJob[];
  onCancelSceneAssetJob: (ideaId: string) => void;
}

const ActiveJobsPanel: React.FC<Props> = ({ jobs, onCancelSceneAssetJob }) => {
  if (!jobs.length) return null;

  return (
    <div className="rounded-2xl border border-emerald-500/20 bg-emerald-500/10 p-4 space-y-3">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[10px] uppercase tracking-wider text-emerald-300">Active Jobs</p>
          <p className="mt-1 text-sm text-emerald-100">Scene asset generations currently running in parallel.</p>
        </div>
        <span className="rounded-full bg-emerald-500/15 px-3 py-1 text-[11px] font-semibold text-emerald-100">
          {jobs.length} running
        </span>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {jobs.map((job) => (
          <div key={job.ideaId} className="rounded-xl border border-white/10 bg-black/20 px-4 py-3">
            <div className="flex items-center justify-between gap-3">
              <p className="text-sm font-semibold text-white">Scene {job.sceneNumber}</p>
              <span className="inline-flex items-center gap-2 text-[11px] text-emerald-100">
                <span className="h-3 w-3 animate-spin rounded-full border-2 border-emerald-100/35 border-t-emerald-100" />
                Generating
              </span>
            </div>
            <p className="mt-2 text-[12px] text-gray-300 line-clamp-2">{job.text}</p>
            <p className="mt-1 text-[11px] text-gray-400">
              Base: {job.assetIndex !== null && job.assetIndex !== undefined ? `Asset ${job.assetIndex + 1}` : 'Prompt only'}
            </p>
            <button
              onClick={() => onCancelSceneAssetJob(job.ideaId)}
              className="mt-3 px-3 py-1.5 rounded-lg border border-red-500/20 bg-red-500/10 text-[11px] font-semibold text-red-200"
            >
              Cancel
            </button>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ActiveJobsPanel;
