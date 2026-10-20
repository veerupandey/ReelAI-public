import React, { useEffect } from 'react';
import { ReelHistoryEntry } from '../services/userDataService';

interface ProjectsPanelProps {
    history: ReelHistoryEntry[];
    onClose: () => void;
    onLoadHistory: (entry: ReelHistoryEntry) => void;
    onRefreshHistory?: () => void;
}

const ProjectsPanel: React.FC<ProjectsPanelProps> = ({ history, onClose, onLoadHistory, onRefreshHistory }) => {
    useEffect(() => {
        console.log('[ProjectsPanel] Mounted, history length:', history.length);
        if (onRefreshHistory) {
            console.log('[ProjectsPanel] Calling onRefreshHistory...');
            onRefreshHistory();
        }
    }, [onRefreshHistory]);
    
    useEffect(() => {
        console.log('[ProjectsPanel] History updated:', history.length, 'items');
    }, [history]);

    const renderStatusPill = (status: ReelHistoryEntry['status'], isAutosaved?: boolean) => {
        if (isAutosaved) {
            return <span className="px-3 py-1 rounded-full text-[11px] font-semibold border bg-purple-500/15 text-purple-300 border-purple-400/30">Autosaved</span>;
        }
        const map: Record<typeof status, { label: string; className: string }> = {
            plan_saved: { label: 'Plan Saved', className: 'bg-blue-500/15 text-blue-300 border-blue-400/30' },
            assets_generated: { label: 'Assets Ready', className: 'bg-emerald-500/15 text-emerald-300 border-emerald-400/30' },
            error: { label: 'Error', className: 'bg-red-500/15 text-red-300 border-red-400/30' }
        };
        const pill = map[status] || map.plan_saved;
        return <span className={`px-3 py-1 rounded-full text-[11px] font-semibold border ${pill.className}`}>{pill.label}</span>;
    };

    const formatTimeAgo = (dateString: string) => {
        const date = new Date(dateString);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMins / 60);
        const diffDays = Math.floor(diffHours / 24);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div className="fixed inset-0 z-[70] bg-black/70 backdrop-blur-sm flex justify-end">
            <div className="w-full max-w-lg h-full bg-gradient-to-b from-[#080B13] via-[#0E1523] to-[#05070F] border-l border-white/10 p-6 overflow-y-auto custom-scrollbar flex flex-col">
                {/* Header */}
                <div className="flex items-center justify-between mb-6">
                    <div>
                        <p className="text-xs uppercase tracking-[0.4em] text-white/40">Workspace</p>
                        <h2 className="text-2xl font-bold">My Projects</h2>
                        <p className="text-sm text-white/60">Resume your previous work.</p>
                    </div>
                    <button onClick={onClose} className="text-white/60 hover:text-white text-2xl">×</button>
                </div>

                {/* Project Count */}
                <div className="mb-4 px-1">
                    <p className="text-xs text-white/40">{history.length} project{history.length !== 1 ? 's' : ''}</p>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-y-auto custom-scrollbar -mr-2 pr-2 space-y-3">
                    {history.length === 0 && (
                        <div className="h-60 flex flex-col items-center justify-center space-y-3 text-center text-white/60">
                            <div className="text-4xl opacity-50">🎬</div>
                            <p>No projects yet.</p>
                            <p className="text-xs text-white/40">Your reels will appear here as you create them.</p>
                        </div>
                    )}

                    {history.map(entry => {
                        const isAutosaved = Boolean(entry.metadata?.isProjectSession);
                        const planAvailable = Boolean(entry.metadata?.plan) || isAutosaved;
                        const planScenes = entry.metadata?.plan?.scenes?.length ?? entry.metadata?.media?.length ?? entry.scenes ?? 0;
                        const hasMedia = (entry.status === 'assets_generated' && entry.metadata?.media) || 
                                        (isAutosaved && entry.metadata?.media?.length > 0);
                        
                        // Use session name for autosaved entries, otherwise use topic
                        const displayName = entry.metadata?.sessionName || 
                                          entry.metadata?.plan?.topic || 
                                          entry.topic || 
                                          'Untitled Reel';

                        return (
                            <div
                                key={entry.id}
                                className="p-4 rounded-2xl border border-white/10 bg-white/5 hover:bg-white/10 transition cursor-pointer group"
                                onClick={() => planAvailable && onLoadHistory(entry)}
                            >
                                <div className="flex items-start justify-between gap-3 mb-3">
                                    <div className="flex-1 min-w-0">
                                        <p className="text-sm font-semibold text-white truncate">
                                            {displayName}
                                        </p>
                                        <p className="text-xs text-white/50">{formatTimeAgo(entry.created_at)}</p>
                                    </div>
                                    {renderStatusPill(entry.status, isAutosaved)}
                                </div>

                                <div className="flex gap-2 mb-4 flex-wrap">
                                    <div className="bg-black/20 rounded px-2 py-1">
                                        <span className="text-[10px] text-white/40 mr-1">Mode:</span>
                                        <span className="text-[11px] text-white/70">{entry.mode || 'Unknown'}</span>
                                    </div>
                                    {planScenes > 0 && (
                                        <div className="bg-black/20 rounded px-2 py-1">
                                            <span className="text-[10px] text-white/40 mr-1">Scenes:</span>
                                            <span className="text-[11px] text-white/70">{planScenes}</span>
                                        </div>
                                    )}
                                    {hasMedia && (
                                        <div className="bg-emerald-500/10 rounded px-2 py-1">
                                            <span className="text-[11px] text-emerald-300">🖼 {entry.metadata?.media?.length || ''} Images</span>
                                        </div>
                                    )}
                                </div>

                                <button
                                    disabled={!planAvailable}
                                    className={`w-full py-2.5 rounded-xl text-xs font-bold uppercase tracking-wider transition ${planAvailable ? 'bg-gradient-to-r from-insta-start to-insta-end hover:opacity-90 text-white' : 'bg-white/5 text-white/20 cursor-not-allowed'}`}
                                >
                                    {planAvailable ? 'Resume Project' : 'Unavailable'}
                                </button>
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};

export default ProjectsPanel;
