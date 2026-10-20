import React, { useState, useRef, useEffect } from 'react';
import type { ApprovalRequest, ApprovalSceneMotion } from '../../services/autonomousAgent';
import type { SceneMotionMode } from '../../types/brand';

export const ApprovalGate: React.FC<{
  approval: ApprovalRequest;
  onResolve: (
    approved: boolean,
    feedback: string,
    sceneMotionModes?: Array<{ index: number; motionMode: SceneMotionMode }>,
  ) => void;
}> = ({ approval, onResolve }) => {
  const [feedback, setFeedback] = useState('');
  const [countdown, setCountdown] = useState(approval.autoApproveAfterSec ?? null);
  const [sceneMotion, setSceneMotion] = useState<ApprovalSceneMotion[]>(
    () => approval.sceneMotionOptions || [],
  );
  const [showForgeCode, setShowForgeCode] = useState(false);
  const sceneMotionRef = useRef(sceneMotion);
  sceneMotionRef.current = sceneMotion;

  useEffect(() => {
    setSceneMotion(approval.sceneMotionOptions || []);
    setShowForgeCode(false);
  }, [approval.approvalId]);

  const motionPayload = () => (
    sceneMotionRef.current.length
      ? sceneMotionRef.current.map((s) => ({ index: s.index, motionMode: s.motionMode }))
      : undefined
  );

  useEffect(() => {
    if (countdown === null) return;
    if (countdown <= 0) { onResolve(true, '', motionPayload()); return; }
    const t = setTimeout(() => setCountdown((c) => (c !== null ? c - 1 : null)), 1000);
    return () => clearTimeout(t);
  }, [countdown, onResolve]);

  const liveCount = sceneMotion.filter((s) => s.motionMode === 'live_motion').length;
  const costPerClip = approval.liveMotionCostPerClipUsd ?? 0.29;
  const modelLabel = approval.liveMotionModelLabel || 'I2V';
  const isForge = approval.phase === 'forge_tool' || Boolean(approval.forgeDraft);

  return (
    <div className="rounded-2xl border-2 border-amber-400/50 bg-amber-400/5 p-5 space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 mb-1">
            <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
            <p className="text-[10px] uppercase tracking-wider text-amber-400 font-semibold">
              {isForge ? 'Helper needs approval' : 'Agent paused — awaiting your input'}
            </p>
          </div>
          <p className="text-white font-semibold text-base">{approval.question}</p>
          {approval.details && !approval.forgeDraft && (
            <p className="text-gray-400 text-xs mt-1 leading-relaxed whitespace-pre-wrap">{approval.details}</p>
          )}
        </div>
        {countdown !== null && (
          <div className="flex-shrink-0 w-10 h-10 rounded-full border-2 border-amber-400/40 flex items-center justify-center">
            <span className="text-amber-300 text-sm font-bold">{countdown}</span>
          </div>
        )}
      </div>

      {sceneMotion.length > 0 && (
        <div className="rounded-xl border border-teal-500/25 bg-teal-500/5 p-3 space-y-2">
          <div className="flex items-center justify-between gap-2">
            <p className="text-[10px] uppercase tracking-wider text-teal-300 font-semibold">
              Per-scene motion · {modelLabel}
            </p>
            <p className="text-[10px] text-gray-500">
              {liveCount}/{sceneMotion.length} Live Motion · ~${(liveCount * costPerClip).toFixed(2)}
            </p>
          </div>
          <div className="space-y-2">
            {sceneMotion.map((scene) => (
              <div
                key={scene.index}
                className="flex items-center justify-between gap-3 rounded-lg border border-dark-border bg-dark-bg/60 px-3 py-2"
              >
                <p className="text-xs text-gray-300 truncate">
                  Scene {scene.index + 1} · <span className="text-white font-medium">{scene.role}</span>
                </p>
                <div className="flex gap-1 shrink-0">
                  {([
                    { value: 'still' as const, label: 'Still' },
                    { value: 'live_motion' as const, label: 'Live Motion' },
                  ]).map((opt) => (
                    <button
                      key={opt.value}
                      type="button"
                      onClick={() => {
                        setCountdown(null);
                        setSceneMotion((prev) => prev.map((s) => (
                          s.index === scene.index ? { ...s, motionMode: opt.value } : s
                        )));
                      }}
                      className={`px-2.5 py-1 rounded-lg text-[10px] font-semibold transition-all ${
                        scene.motionMode === opt.value
                          ? opt.value === 'live_motion'
                            ? 'bg-teal-500/25 border border-teal-400/50 text-teal-100'
                            : 'bg-white/10 border border-white/25 text-white'
                          : 'bg-transparent border border-dark-border text-gray-500 hover:text-gray-300'
                      }`}
                    >
                      {opt.label}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
          <p className="text-[10px] text-gray-600 leading-relaxed">
            Live Motion animates each approved still with {modelLabel}, then time-fits to the scene length.
          </p>
        </div>
      )}

      {approval.forgeDraft && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2.5 text-[11px] text-amber-100 space-y-2">
          <p className="font-semibold text-amber-200">
            Run this helper for this session
          </p>
          <p>
            <span className="text-amber-300/80">Helper:</span>{' '}
            <span className="font-medium text-white">{approval.forgeDraft.name}</span>
          </p>
          <p className="text-amber-100/90 leading-relaxed">
            {approval.forgeDraft.reason || approval.forgeDraft.description}
          </p>
          {approval.forgeDraft.description && approval.forgeDraft.reason !== approval.forgeDraft.description ? (
            <p className="text-amber-100/70 text-[10px]">{approval.forgeDraft.description}</p>
          ) : null}
          {approval.forgeDraft.code ? (
            <div>
              <button
                type="button"
                onClick={() => setShowForgeCode((v) => !v)}
                className="text-[10px] text-amber-300/80 hover:text-amber-200 underline-offset-2 hover:underline"
              >
                {showForgeCode ? 'Hide script' : 'Show script'}
              </button>
              {showForgeCode && (
                <pre className="mt-2 max-h-48 overflow-auto rounded-lg bg-black/40 p-2 text-[10px] text-amber-100/80 font-mono whitespace-pre-wrap">
                  {approval.forgeDraft.code}
                </pre>
              )}
            </div>
          ) : null}
        </div>
      )}

      <textarea
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        placeholder={
          approval.phase === 'deliver'
            ? "Selective redo: e.g. 'use live motion' · 'change the model' · or Approve"
            : approval.phase === 'plan_loop'
              ? "Optional: adjust recreate plan — e.g. 'prefer Ken Burns' · 'use live motion on hook'"
            : approval.phase === 'forge_tool'
              ? 'Optional note, then Approve to run this helper for this session'
            : approval.phase === 'plan_scenes'
              ? "Optional: e.g. 'use live motion on all scenes' · 'make scene 2 more dramatic'"
              : approval.phase === 'generate_images'
                ? "Optional: e.g. 'redo scene 2' · 'different dress'"
                : "Optional feedback, or Approve to continue"
        }
        className="w-full px-3 py-2.5 rounded-xl bg-dark-bg border border-dark-border text-sm text-white placeholder-gray-600 focus:border-amber-400/50 focus:outline-none resize-none"
        rows={2}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && e.metaKey) onResolve(true, feedback, motionPayload());
        }}
      />

      <div className="flex gap-2">
        <button
          onClick={() => onResolve(true, feedback, motionPayload())}
          className="flex-1 py-2.5 rounded-xl bg-gradient-to-r from-emerald-600 to-cyan-500 text-white font-bold text-sm hover:opacity-90 transition-opacity"
        >
          {feedback.trim()
            ? (approval.phase === 'deliver' ? 'Apply Redo & Reassemble →' : 'Apply Feedback & Continue →')
            : (approval.phase === 'forge_tool'
              ? 'Approve & run helper →'
              : approval.phase === 'plan_loop'
                ? 'Approve recreate plan →'
                : approval.phase === 'deliver' ? 'Deliver as-is →' : 'Approve & Continue →')}
        </button>
        <button
          onClick={() => onResolve(false, '')}
          className="px-4 py-2.5 rounded-xl bg-dark-card border border-dark-border text-gray-400 hover:text-red-400 hover:border-red-500/30 text-sm font-medium transition-all"
        >
          Stop
        </button>
      </div>

      {countdown !== null && (
        <p className="text-[10px] text-amber-400/60 text-center">
          Auto-approving in {countdown}s · type feedback or click Approve to continue now
        </p>
      )}
    </div>
  );
};
