import React, { useState, useEffect } from 'react';
import { usageTracker, UsageStats as UsageStatsType } from '../utils/usageTracker';

interface UsageStatsProps {
    onClose: () => void;
}

const UsageStats: React.FC<UsageStatsProps> = ({ onClose }) => {
    const [stats, setStats] = useState<UsageStatsType>(usageTracker.getStats());

    // Refresh stats every second
    useEffect(() => {
        const interval = setInterval(() => {
            setStats(usageTracker.getStats());
        }, 1000);
        return () => clearInterval(interval);
    }, []);

    const breakdown = usageTracker.getCostBreakdown();
    const sessionDuration = usageTracker.getSessionDuration();
    const hours = Math.floor(sessionDuration / (1000 * 60 * 60));
    const minutes = Math.floor((sessionDuration % (1000 * 60 * 60)) / (1000 * 60));

    const handleReset = () => {
        if (confirm('Are you sure you want to reset all usage stats?')) {
            usageTracker.reset();
            setStats(usageTracker.getStats());
        }
    };

    return (
        <div className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-50 p-4" onClick={onClose}>
            <div className="bg-gradient-to-br from-[#0B1121] to-[#05070F] border border-white/10 rounded-3xl p-8 max-w-2xl w-full max-h-[90vh] overflow-y-auto custom-scrollbar" onClick={(e) => e.stopPropagation()}>
                {/* Header */}
                <div className="flex justify-between items-center mb-6">
                    <h2 className="text-2xl font-bold">💰 API Usage & Costs</h2>
                    <button onClick={onClose} className="text-white/60 hover:text-white text-2xl">×</button>
                </div>

                {/* Summary Cards */}
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                        <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Total Cost</div>
                        <div className="text-3xl font-bold text-insta-mid">${stats.totalCost.toFixed(4)}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                        <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Text Tokens</div>
                        <div className="text-3xl font-bold">{(stats.totalInputTokens + stats.totalOutputTokens).toLocaleString()}</div>
                    </div>
                    <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                        <div className="text-xs uppercase tracking-widest text-white/40 mb-2">Images</div>
                        <div className="text-3xl font-bold text-insta-purple">{stats.totalImages}</div>
                    </div>
                </div>

                {/* Cost Breakdown */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                    <h3 className="text-lg font-bold mb-4">Cost Breakdown</h3>
                    <div className="space-y-3">
                        <div className="flex justify-between items-center">
                            <span className="text-white/70">Input Tokens ({stats.totalInputTokens.toLocaleString()})</span>
                            <span className="font-mono">${breakdown.inputCost.toFixed(6)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-white/70">Output Tokens ({stats.totalOutputTokens.toLocaleString()})</span>
                            <span className="font-mono">${breakdown.outputCost.toFixed(6)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-white/70">Images ({stats.totalImages})</span>
                            <span className="font-mono">${breakdown.imageCost.toFixed(4)}</span>
                        </div>
                        <div className="flex justify-between items-center">
                            <span className="text-white/70">TTS Audio ({stats.totalTTSCharacters.toLocaleString()} chars)</span>
                            <span className="font-mono">${breakdown.ttsCost.toFixed(4)}</span>
                        </div>
                        <div className="border-t border-white/10 pt-3 flex justify-between items-center font-bold">
                            <span>Total</span>
                            <span className="text-insta-mid">${breakdown.totalCost.toFixed(4)}</span>
                        </div>
                    </div>
                </div>

                {/* Session Info */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                    <div className="flex justify-between items-center">
                        <div>
                            <div className="text-xs uppercase tracking-widest text-white/40 mb-1">Session Duration</div>
                            <div className="text-lg font-semibold">{hours > 0 ? `${hours}h ` : ''}{minutes}m</div>
                        </div>
                        <div className="text-right">
                            <div className="text-xs uppercase tracking-widest text-white/40 mb-1">Operations</div>
                            <div className="text-lg font-semibold">{stats.records.length}</div>
                        </div>
                    </div>
                </div>

                {/* Recent Activity */}
                <div className="bg-white/5 border border-white/10 rounded-2xl p-6 mb-6">
                    <h3 className="text-lg font-bold mb-4">Recent Operations</h3>
                    <div className="space-y-2 max-h-60 overflow-y-auto custom-scrollbar">
                        {stats.records.length === 0 ? (
                            <div className="text-center text-white/40 py-8">No operations yet</div>
                        ) : (
                            stats.records.slice().reverse().slice(0, 20).map((record, i) => (
                                <div key={i} className="flex justify-between items-center text-sm py-2 border-b border-white/5">
                                    <div className="flex-1">
                                        <span className="font-semibold">{record.operation}</span>
                                        <div className="text-xs text-white/40">
                                            {record.imageCount > 0 ? (
                                                `${record.imageCount} image${record.imageCount > 1 ? 's' : ''}`
                                            ) : record.ttsCharacters > 0 ? (
                                                `${record.ttsCharacters} chars (TTS)`
                                            ) : (
                                                `${record.inputTokens + record.outputTokens} tokens`
                                            )}
                                        </div>
                                    </div>
                                    <div className="text-xs text-white/40">
                                        {new Date(record.timestamp).toLocaleTimeString()}
                                    </div>
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Actions */}
                <div className="flex gap-4">
                    <button
                        onClick={handleReset}
                        className="flex-1 py-3 rounded-xl border border-red-500/30 text-red-400 font-semibold hover:bg-red-500/10 transition"
                    >
                        Reset Stats
                    </button>
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 rounded-xl bg-white text-black font-semibold hover:-translate-y-0.5 transition"
                    >
                        Close
                    </button>
                </div>
            </div>
        </div>
    );
};

export default UsageStats;
