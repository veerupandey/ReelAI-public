/**
 * KeyframeTimeline — Visual editor for per-scene camera motion keyframes.
 *
 * Features:
 * - Multiple tracks: Scale, Pan X, Pan Y, Rotation, Opacity
 * - Drag keyframes horizontally to change time
 * - Click on track to add keyframe at that position
 * - Double-click keyframe to edit value + easing
 * - Visual curve preview showing the interpolated path
 * - Per-scene keyframe storage that feeds into evaluateKeyframeTrack
 */

import React, { useState, useRef, useCallback, useMemo } from 'react';
import { Keyframe, KeyframeTrack, evaluateKeyframeTrack } from '../utils/motionEngine';

export interface SceneKeyframes {
    [sceneIndex: number]: KeyframeTrack[];
}

interface KeyframeTimelineProps {
    sceneIndex: number;
    keyframes: SceneKeyframes;
    onChange: (keyframes: SceneKeyframes) => void;
}

const TRACK_CONFIG: { property: KeyframeTrack['property']; label: string; color: string; min: number; max: number; defaultValue: number }[] = [
    { property: 'scale', label: 'Scale', color: '#f09433', min: 0.5, max: 3, defaultValue: 1 },
    { property: 'panX', label: 'Pan X', color: '#e6683c', min: -200, max: 200, defaultValue: 0 },
    { property: 'panY', label: 'Pan Y', color: '#dc2743', min: -200, max: 200, defaultValue: 0 },
    { property: 'rotation', label: 'Rotation', color: '#bc1888', min: -45, max: 45, defaultValue: 0 },
    { property: 'opacity', label: 'Opacity', color: '#8b5cf6', min: 0, max: 1, defaultValue: 1 },
];

const EASING_OPTIONS: Keyframe['easing'][] = ['linear', 'ease-in', 'ease-out', 'ease-in-out', 'bezier'];

export const KeyframeTimeline: React.FC<KeyframeTimelineProps> = ({ sceneIndex, keyframes, onChange }) => {
    const [selectedTrack, setSelectedTrack] = useState<number>(0);
    const [editingKf, setEditingKf] = useState<{ trackIdx: number; kfIdx: number } | null>(null);
    const [dragging, setDragging] = useState<{ trackIdx: number; kfIdx: number } | null>(null);
    const trackRefs = useRef<(HTMLDivElement | null)[]>([]);

    const sceneTracks = keyframes[sceneIndex] || [];

    const getTrack = useCallback((trackIdx: number): KeyframeTrack => {
        return sceneTracks[trackIdx] || { property: TRACK_CONFIG[trackIdx].property, keyframes: [] };
    }, [sceneTracks]);

    const updateTrack = useCallback((trackIdx: number, track: KeyframeTrack) => {
        const newKeyframes = { ...keyframes };
        const tracks = [...(newKeyframes[sceneIndex] || [])];
        tracks[trackIdx] = track;
        newKeyframes[sceneIndex] = tracks;
        onChange(newKeyframes);
    }, [keyframes, sceneIndex, onChange]);

    const handleTrackClick = useCallback((trackIdx: number, e: React.MouseEvent<HTMLDivElement>) => {
        const rect = e.currentTarget.getBoundingClientRect();
        const x = (e.clientX - rect.left) / rect.width;
        const t = Math.max(0, Math.min(1, x));
        const config = TRACK_CONFIG[trackIdx];
        const track = getTrack(trackIdx);

        // Don't add if clicking too close to existing keyframe
        const tooClose = track.keyframes.some(kf => Math.abs(kf.time - t) < 0.05);
        if (tooClose) return;

        const newKf: Keyframe = { time: t, value: config.defaultValue, easing: 'ease-in-out' };
        const sortedKfs = [...track.keyframes, newKf].sort((a, b) => a.time - b.time);
        updateTrack(trackIdx, { ...track, keyframes: sortedKfs });
    }, [getTrack, updateTrack]);

    const handleKfDrag = useCallback((trackIdx: number, kfIdx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        setDragging({ trackIdx, kfIdx });

        const onMove = (ev: MouseEvent) => {
            const trackEl = trackRefs.current[trackIdx];
            if (!trackEl) return;
            const rect = trackEl.getBoundingClientRect();
            const x = (ev.clientX - rect.left) / rect.width;
            const newTime = Math.max(0, Math.min(1, x));

            const track = getTrack(trackIdx);
            const kfs = [...track.keyframes];
            kfs[kfIdx] = { ...kfs[kfIdx], time: newTime };
            const sortedKfs = kfs.sort((a, b) => a.time - b.time);
            updateTrack(trackIdx, { ...track, keyframes: sortedKfs });
        };

        const onUp = () => {
            setDragging(null);
            window.removeEventListener('mousemove', onMove);
            window.removeEventListener('mouseup', onUp);
        };

        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
    }, [getTrack, updateTrack]);

    const deleteKf = useCallback((trackIdx: number, kfIdx: number) => {
        const track = getTrack(trackIdx);
        const kfs = track.keyframes.filter((_, i) => i !== kfIdx);
        updateTrack(trackIdx, { ...track, keyframes: kfs });
        setEditingKf(null);
    }, [getTrack, updateTrack]);

    const updateKfValue = useCallback((trackIdx: number, kfIdx: number, value: number) => {
        const track = getTrack(trackIdx);
        const kfs = [...track.keyframes];
        kfs[kfIdx] = { ...kfs[kfIdx], value };
        updateTrack(trackIdx, { ...track, keyframes: kfs });
    }, [getTrack, updateTrack]);

    const updateKfEasing = useCallback((trackIdx: number, kfIdx: number, easing: Keyframe['easing']) => {
        const track = getTrack(trackIdx);
        const kfs = [...track.keyframes];
        kfs[kfIdx] = { ...kfs[kfIdx], easing, bezierCP: easing === 'bezier' ? [0.42, 0, 0.58, 1] : undefined };
        updateTrack(trackIdx, { ...track, keyframes: kfs });
    }, [getTrack, updateTrack]);

    // Generate curve preview points
    const curvePoints = useMemo((trackIdx: number) => {
        return (trackIdx: number) => {
            const track = getTrack(trackIdx);
            if (track.keyframes.length < 2) return [];
            const points: { x: number; y: number }[] = [];
            const config = TRACK_CONFIG[trackIdx];
            for (let i = 0; i <= 60; i++) {
                const t = i / 60;
                const val = evaluateKeyframeTrack(track, t);
                const x = t * 100;
                const y = 100 - ((val - config.min) / (config.max - config.min)) * 100;
                points.push({ x, y: Math.max(0, Math.min(100, y)) });
            }
            return points;
        };
    }, [getTrack]);

    return (
        <div className="space-y-2">
            <div className="flex items-center justify-between">
                <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Keyframe Timeline</p>
                <span className="text-[9px] text-gray-600">Scene {sceneIndex + 1} · Click track to add · Drag to move</span>
            </div>

            {/* Track selector tabs */}
            <div className="flex gap-1">
                {TRACK_CONFIG.map((config, idx) => (
                    <button
                        key={config.property}
                        onClick={() => setSelectedTrack(idx)}
                        className={`px-2 py-1 rounded text-[9px] font-bold transition ${selectedTrack === idx ? 'text-white' : 'text-gray-500 bg-black/20'}`}
                        style={selectedTrack === idx ? { backgroundColor: config.color } : {}}
                    >
                        {config.label}
                    </button>
                ))}
            </div>

            {/* Timeline tracks */}
            <div className="space-y-1.5">
                {TRACK_CONFIG.map((config, trackIdx) => {
                    const track = getTrack(trackIdx);
                    const points = curvePoints(trackIdx);
                    const pathD = points.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x} ${p.y}`).join(' ');

                    return (
                        <div
                            key={config.property}
                            className={`rounded-lg overflow-hidden transition ${selectedTrack === trackIdx ? 'ring-1' : ''}`}
                            style={{ boxShadow: selectedTrack === trackIdx ? `0 0 0 1px ${config.color}40` : 'none' }}
                        >
                            {/* Track label */}
                            <div className="flex items-center justify-between px-2 py-1 bg-black/40">
                                <button
                                    onClick={() => setSelectedTrack(trackIdx)}
                                    className="text-[9px] font-bold flex items-center gap-1.5"
                                    style={{ color: config.color }}
                                >
                                    <span className="w-2 h-2 rounded-full" style={{ backgroundColor: config.color }} />
                                    {config.label}
                                </button>
                                <span className="text-[8px] text-gray-600">{track.keyframes.length} keys</span>
                            </div>

                            {/* Track body */}
                            <div
                                ref={(el) => { trackRefs.current[trackIdx] = el; }}
                                onClick={(e) => handleTrackClick(trackIdx, e)}
                                className="relative h-12 bg-black/30 cursor-crosshair"
                            >
                                {/* Grid lines */}
                                <div className="absolute inset-0 flex">
                                    {[0.25, 0.5, 0.75].map(p => (
                                        <div key={p} className="absolute top-0 bottom-0 w-px bg-white/5" style={{ left: `${p * 100}%` }} />
                                    ))}
                                </div>

                                {/* Curve preview */}
                                {points.length > 1 && (
                                    <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 100 100" preserveAspectRatio="none">
                                        <path d={pathD} fill="none" stroke={config.color} strokeWidth="0.5" opacity="0.4" />
                                    </svg>
                                )}

                                {/* Keyframe markers */}
                                {track.keyframes.map((kf, kfIdx) => (
                                    <div
                                        key={kfIdx}
                                        onMouseDown={(e) => handleKfDrag(trackIdx, kfIdx, e)}
                                        onDoubleClick={(e) => { e.stopPropagation(); setEditingKf({ trackIdx, kfIdx }); }}
                                        className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 w-3 h-3 rotate-45 cursor-grab active:cursor-grabbing transition hover:scale-125"
                                        style={{
                                            left: `${kf.time * 100}%`,
                                            backgroundColor: config.color,
                                            boxShadow: dragging?.kfIdx === kfIdx ? `0 0 8px ${config.color}` : 'none',
                                        }}
                                        title={`t=${(kf.time * 100).toFixed(0)}% · val=${kf.value.toFixed(2)} · ${kf.easing}`}
                                    />
                                ))}
                            </div>
                        </div>
                    );
                })}
            </div>

            {/* Keyframe editor panel */}
            {editingKf && (() => {
                const track = getTrack(editingKf.trackIdx);
                const kf = track.keyframes[editingKf.kfIdx];
                if (!kf) return null;
                const config = TRACK_CONFIG[editingKf.trackIdx];

                return (
                    <div className="p-3 bg-black/40 rounded-xl border border-white/10 space-y-2">
                        <div className="flex items-center justify-between">
                            <p className="text-[10px] font-bold text-gray-400 uppercase">Edit Keyframe · {config.label}</p>
                            <button onClick={() => setEditingKf(null)} className="text-gray-500 hover:text-white text-xs">✕</button>
                        </div>

                        <div className="grid grid-cols-2 gap-2">
                            <div>
                                <label className="text-[9px] text-gray-500 block mb-1">Time ({(kf.time * 100).toFixed(0)}%)</label>
                                <input
                                    type="range" min="0" max="1" step="0.01"
                                    value={kf.time}
                                    onChange={e => {
                                        const track = getTrack(editingKf.trackIdx);
                                        const kfs = [...track.keyframes];
                                        kfs[editingKf.kfIdx] = { ...kfs[editingKf.kfIdx], time: parseFloat(e.target.value) };
                                        updateTrack(editingKf.trackIdx, { ...track, keyframes: kfs.sort((a, b) => a.time - b.time) });
                                    }}
                                    className="w-full accent-insta-mid h-1"
                                />
                            </div>
                            <div>
                                <label className="text-[9px] text-gray-500 block mb-1">Value ({kf.value.toFixed(2)})</label>
                                <input
                                    type="range" min={config.min} max={config.max} step="0.01"
                                    value={kf.value}
                                    onChange={e => updateKfValue(editingKf.trackIdx, editingKf.kfIdx, parseFloat(e.target.value))}
                                    className="w-full accent-insta-mid h-1"
                                />
                            </div>
                        </div>

                        <div>
                            <label className="text-[9px] text-gray-500 block mb-1">Easing</label>
                            <div className="flex gap-1">
                                {EASING_OPTIONS.map(easing => (
                                    <button
                                        key={easing}
                                        onClick={() => updateKfEasing(editingKf.trackIdx, editingKf.kfIdx, easing)}
                                        className={`px-2 py-1 rounded text-[8px] font-bold ${kf.easing === easing ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-500'}`}
                                    >
                                        {easing}
                                    </button>
                                ))}
                            </div>
                        </div>

                        <button
                            onClick={() => deleteKf(editingKf.trackIdx, editingKf.kfIdx)}
                            className="w-full py-1.5 rounded-lg text-[9px] font-bold bg-red-500/20 text-red-400 hover:bg-red-500/30 transition"
                        >
                            Delete Keyframe
                        </button>
                    </div>
                );
            })()}

            {/* Clear all button */}
            {sceneTracks.some(t => t.keyframes.length > 0) && (
                <button
                    onClick={() => {
                        const newKf = { ...keyframes };
                        delete newKf[sceneIndex];
                        onChange(newKf);
                    }}
                    className="w-full py-1.5 rounded-lg text-[9px] font-bold bg-black/30 text-gray-500 hover:text-gray-300 transition"
                >
                    Clear All Keyframes
                </button>
            )}
        </div>
    );
};
