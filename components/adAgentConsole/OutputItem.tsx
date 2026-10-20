import React from 'react';
import type { AgentEvent } from '../../services/autonomousAgent';
import { normalizeAdAgentFileUrl } from './utils';

/** Renders a single agent output event in the creative feed. */
export const OutputItem: React.FC<{ event: AgentEvent }> = ({ event }) => {
  const o = event.output;
  if (!o) return null;

  // Milestones read as a timeline line, not as another card in the feed.
  if (o.label === 'Step' && o.type === 'markdown') {
    return (
      <div className="flex items-start gap-2.5 px-1 py-0.5">
        <span className="mt-[7px] w-1.5 h-1.5 rounded-full bg-teal-400/80 shrink-0" />
        <p className="text-[13px] text-gray-300 leading-relaxed">{o.content}</p>
      </div>
    );
  }

  if (o.type === 'markdown') {
    return (
      <div className="bg-dark-card rounded-xl border border-dark-border p-4 space-y-1">
        {o.label && <p className="text-[10px] uppercase tracking-wider text-purple-400 font-semibold">{o.label}</p>}
        <pre className="text-sm text-gray-300 whitespace-pre-wrap font-sans leading-relaxed">{o.content}</pre>
      </div>
    );
  }

  if (o.type === 'image' && o.url) {
    return (
      <div className="rounded-xl overflow-hidden border border-dark-border bg-black/30">
        {o.label && (
          <div className="px-3 py-1.5 bg-dark-card/80 border-b border-dark-border flex items-center justify-between">
            <p className="text-[10px] uppercase tracking-wider text-cyan-400 font-semibold">{o.label}</p>
          </div>
        )}
        <img src={o.url} alt={o.label || ''} className="w-full max-h-[420px] object-contain bg-black/40" />
      </div>
    );
  }

  if (o.type === 'video' && o.url) {
    const videoUrl = normalizeAdAgentFileUrl(o.url);
    return (
      <div className="rounded-xl overflow-hidden border border-purple-500/40 bg-black/30">
        <div className="px-3 py-2 bg-purple-500/10 border-b border-purple-500/30 flex items-center justify-between">
          <p className="text-[10px] uppercase tracking-wider text-purple-300 font-semibold">{o.label || 'Final Ad'}</p>
          <a href={videoUrl} download="reelai-ad.mp4"
            className="text-[10px] px-3 py-1 rounded-lg bg-purple-500/20 border border-purple-500/30 text-purple-200 hover:bg-purple-500/30">
            Download MP4
          </a>
        </div>
        <video src={videoUrl} controls className="w-full max-h-[520px] bg-black" />
      </div>
    );
  }

  if (o.type === 'audio' && o.url) {
    return (
      <div className="rounded-xl border border-dark-border bg-dark-card p-3 space-y-1">
        {o.label && <p className="text-[10px] uppercase tracking-wider text-cyan-400">{o.label}</p>}
        <audio src={o.url} controls className="w-full" />
      </div>
    );
  }

  if (o.type === 'terminal') {
    return (
      <div className="rounded-xl border border-green-900/50 bg-black/70 p-3 font-mono overflow-x-auto">
        {o.label && <p className="text-green-500/60 text-[10px] mb-1"># {o.label}</p>}
        <pre className="text-green-300/90 text-[11px] whitespace-pre-wrap leading-relaxed">{o.content}</pre>
      </div>
    );
  }

  if (o.type === 'error') {
    return (
      <div className="rounded-xl border border-red-500/30 bg-red-500/5 p-3 text-xs text-red-300 font-mono whitespace-pre-wrap">
        {o.content}
      </div>
    );
  }

  return null;
};
