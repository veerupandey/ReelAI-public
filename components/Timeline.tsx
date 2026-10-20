import React, { useRef, useState, useEffect, useMemo } from 'react';
import { UploadedMedia, TransitionEffect } from '../types';
import { getMediaDisplayUrl } from '../utils/sceneDrafts';

interface TimelineProps {
    media: UploadedMedia[];
    selectedIndex: number;
    onSelect: (index: number) => void;
    onReorder: (fromIndex: number, toIndex: number) => void;
    onTransitionChange: (index: number, transition: TransitionEffect) => void;
    onDelete?: (index: number) => void;
    onDuplicate?: (index: number) => void;
    onAddClips?: () => void;
    onSplit?: (index: number, splitTime: number) => void;
    onCopy?: (clip: UploadedMedia) => void;
    onPaste?: (afterIndex: number) => void;
    clipboard?: UploadedMedia | null;
    isPlaying?: boolean;
    onPlayToggle?: () => void;
    currentTime?: number;
    onSeek?: (time: number) => void;
}

const Timeline: React.FC<TimelineProps> = ({
    media,
    selectedIndex,
    onSelect,
    onReorder,
    onTransitionChange,
    onDelete,
    onDuplicate,
    onAddClips,
    onSplit,
    onCopy,
    onPaste,
    clipboard,
    isPlaying,
    onPlayToggle,
    currentTime = 0,
    onSeek
}) => {
    const [draggedIndex, setDraggedIndex] = useState<number | null>(null);
    const [zoom, setZoom] = useState(1);
    const [contextMenu, setContextMenu] = useState<{ x: number; y: number; index: number } | null>(null);
    const [snapEnabled, setSnapEnabled] = useState(true);
    const [bladeMode, setBladeMode] = useState(false);
    const [isDraggingPlayhead, setIsDraggingPlayhead] = useState(false);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const tracksRef = useRef<HTMLDivElement>(null);

    const basePixelsPerSecond = 40;
    const pixelsPerSecond = basePixelsPerSecond * zoom;

    // Calculate clip start times and total duration
    const clipData = useMemo(() => {
        let accumulatedTime = 0;
        const MAX_CLIP = 30;
        return media.map((clip) => {
            const start = typeof clip.startTime === 'number' ? clip.startTime : 0;
            const end = typeof clip.endTime === 'number' ? clip.endTime : (clip.duration || 3);
            const trimmedDuration = Math.max(0.5, Math.min(MAX_CLIP, end - start));
            const effectiveDuration = typeof clip.extendedDuration === 'number' && Number.isFinite(clip.extendedDuration)
                ? Math.max(0.5, Math.min(MAX_CLIP, clip.extendedDuration))
                : trimmedDuration;
            const clipStart = accumulatedTime;
            accumulatedTime += effectiveDuration;
            return { clipStart, effectiveDuration, start, end };
        });
    }, [media]);

    const totalDuration = clipData.reduce((acc, c) => acc + c.effectiveDuration, 0);

    // Get playhead position in pixels
    const playheadPosition = currentTime * pixelsPerSecond;

    // Find which clip the playhead is over
    const playheadClipIndex = useMemo(() => {
        let acc = 0;
        for (let i = 0; i < clipData.length; i++) {
            if (currentTime >= acc && currentTime < acc + clipData[i].effectiveDuration) {
                return i;
            }
            acc += clipData[i].effectiveDuration;
        }
        return clipData.length - 1;
    }, [currentTime, clipData]);

    // Time within the current clip
    const timeInCurrentClip = useMemo(() => {
        let acc = 0;
        for (let i = 0; i < playheadClipIndex; i++) {
            acc += clipData[i].effectiveDuration;
        }
        return currentTime - acc;
    }, [currentTime, playheadClipIndex, clipData]);

    // Keyboard shortcuts
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;

            switch (e.key) {
                case ' ':
                    e.preventDefault();
                    onPlayToggle?.();
                    break;
                case 'ArrowLeft':
                    e.preventDefault();
                    if (e.shiftKey) {
                        // Frame back
                        onSeek?.(Math.max(0, currentTime - 0.1));
                    } else {
                        if (selectedIndex > 0) onSelect(selectedIndex - 1);
                    }
                    break;
                case 'ArrowRight':
                    e.preventDefault();
                    if (e.shiftKey) {
                        // Frame forward
                        onSeek?.(Math.min(totalDuration, currentTime + 0.1));
                    } else {
                        if (selectedIndex < media.length - 1) onSelect(selectedIndex + 1);
                    }
                    break;
                case 'Delete':
                case 'Backspace':
                    e.preventDefault();
                    if (onDelete && media.length > 1) onDelete(selectedIndex);
                    break;
                case 's':
                case 'S':
                    if (!e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        // Split at playhead
                        if (onSplit && timeInCurrentClip > 0.1 && timeInCurrentClip < clipData[playheadClipIndex].effectiveDuration - 0.1) {
                            onSplit(playheadClipIndex, timeInCurrentClip);
                        }
                    }
                    break;
                case 'b':
                case 'B':
                    if (!e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        setBladeMode(!bladeMode);
                    }
                    break;
                case 'n':
                case 'N':
                    if (!e.metaKey && !e.ctrlKey) {
                        e.preventDefault();
                        setSnapEnabled(!snapEnabled);
                    }
                    break;
                case 'c':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        onCopy?.(media[selectedIndex]);
                    }
                    break;
                case 'v':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        onPaste?.(selectedIndex);
                    }
                    break;
                case 'x':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        onCopy?.(media[selectedIndex]);
                        if (media.length > 1) onDelete?.(selectedIndex);
                    }
                    break;
                case 'd':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        onDuplicate?.(selectedIndex);
                    }
                    break;
                case '+':
                case '=':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        setZoom(z => Math.min(3, z + 0.25));
                    }
                    break;
                case '-':
                    if (e.metaKey || e.ctrlKey) {
                        e.preventDefault();
                        setZoom(z => Math.max(0.25, z - 0.25));
                    }
                    break;
                case 'Home':
                    e.preventDefault();
                    onSeek?.(0);
                    break;
                case 'End':
                    e.preventDefault();
                    onSeek?.(totalDuration);
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [selectedIndex, media, onSelect, onPlayToggle, onDelete, onDuplicate, onSplit, onCopy, onPaste, bladeMode, snapEnabled, currentTime, totalDuration, playheadClipIndex, timeInCurrentClip, clipData, onSeek]);

    // Close context menu
    useEffect(() => {
        const handleClick = () => setContextMenu(null);
        if (contextMenu) {
            window.addEventListener('click', handleClick);
            return () => window.removeEventListener('click', handleClick);
        }
    }, [contextMenu]);

    // Playhead dragging
    const handlePlayheadMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsDraggingPlayhead(true);
    };

    useEffect(() => {
        if (!isDraggingPlayhead) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (!tracksRef.current) return;
            const rect = tracksRef.current.getBoundingClientRect();
            const x = e.clientX - rect.left + (scrollContainerRef.current?.scrollLeft || 0);
            const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));

            // Snap to clip boundaries if enabled
            if (snapEnabled) {
                let acc = 0;
                for (const cd of clipData) {
                    if (Math.abs(time - acc) < 0.2) {
                        onSeek?.(acc);
                        return;
                    }
                    acc += cd.effectiveDuration;
                }
                if (Math.abs(time - totalDuration) < 0.2) {
                    onSeek?.(totalDuration);
                    return;
                }
            }
            onSeek?.(time);
        };

        const handleMouseUp = () => setIsDraggingPlayhead(false);

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isDraggingPlayhead, pixelsPerSecond, totalDuration, snapEnabled, clipData, onSeek]);

    // Track click to seek
    const handleTrackClick = (e: React.MouseEvent) => {
        if (!tracksRef.current || bladeMode) return;
        const rect = tracksRef.current.getBoundingClientRect();
        const x = e.clientX - rect.left + (scrollContainerRef.current?.scrollLeft || 0);
        const time = Math.max(0, Math.min(totalDuration, x / pixelsPerSecond));
        onSeek?.(time);
    };

    // Blade mode click to split
    const handleClipBladeClick = (e: React.MouseEvent, index: number) => {
        if (!bladeMode || !onSplit) return;
        e.stopPropagation();

        const clipElement = e.currentTarget as HTMLElement;
        const rect = clipElement.getBoundingClientRect();
        const clickX = e.clientX - rect.left;
        const splitTime = clickX / pixelsPerSecond;

        if (splitTime > 0.1 && splitTime < clipData[index].effectiveDuration - 0.1) {
            onSplit(index, splitTime);
        }
    };

    const handleDragStart = (e: React.DragEvent, index: number) => {
        if (bladeMode) {
            e.preventDefault();
            return;
        }
        setDraggedIndex(index);
        e.dataTransfer.effectAllowed = 'move';
        const img = new Image();
        img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
        e.dataTransfer.setDragImage(img, 0, 0);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
    };

    const handleDrop = (e: React.DragEvent, targetIndex: number) => {
        e.preventDefault();
        if (draggedIndex !== null && draggedIndex !== targetIndex) {
            onReorder(draggedIndex, targetIndex);
        }
        setDraggedIndex(null);
    };

    const handleContextMenu = (e: React.MouseEvent, index: number) => {
        e.preventDefault();
        setContextMenu({ x: e.clientX, y: e.clientY, index });
    };

    const getTransitionIcon = (effect?: TransitionEffect) => {
        switch (effect) {
            case 'fade': return '🌫️';
            case 'slide': return '↔️';
            case 'zoom': return '🔍';
            default: return '│';
        }
    };

    const cycleTransition = (index: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const transitions: TransitionEffect[] = ['none', 'fade', 'slide', 'zoom'];
        const current = media[index].transitionEffect || 'none';
        const nextIndex = (transitions.indexOf(current) + 1) % transitions.length;
        onTransitionChange(index, transitions[nextIndex]);
    };

    const formatTime = (seconds: number) => {
        const mins = Math.floor(seconds / 60);
        const secs = Math.floor(seconds % 60);
        const frames = Math.floor((seconds % 1) * 30); // 30fps
        return `${mins}:${secs.toString().padStart(2, '0')}:${frames.toString().padStart(2, '0')}`;
    };

    // Generate time markers
    const timeMarkers = useMemo(() => {
        const markers = [];
        const interval = zoom < 0.75 ? 5 : zoom < 1.5 ? 2 : 1;
        for (let t = 0; t <= totalDuration; t += interval) {
            markers.push(t);
        }
        return markers;
    }, [totalDuration, zoom]);

    return (
        <div ref={containerRef} className="h-56 bg-[#05070F] border-t border-white/10 flex flex-col select-none">
            {/* Timeline Header */}
            <div className="h-12 border-b border-white/5 flex items-center justify-between px-4 bg-black/30">
                <div className="flex items-center gap-3">
                    {/* Play Button */}
                    <button
                        onClick={onPlayToggle}
                        className="w-9 h-9 rounded-full bg-insta-mid hover:bg-insta-purple transition flex items-center justify-center text-lg"
                        title="Space"
                    >
                        {isPlaying ? '⏸' : '▶️'}
                    </button>

                    {/* Current Time */}
                    <div className="font-mono text-sm">
                        <span className="text-white font-bold">{formatTime(currentTime)}</span>
                        <span className="text-white/30 mx-1">/</span>
                        <span className="text-white/50">{formatTime(totalDuration)}</span>
                    </div>

                    <div className="h-6 w-px bg-white/10" />

                    {/* Tool Buttons */}
                    <div className="flex items-center gap-1">
                        <button
                            onClick={() => setBladeMode(!bladeMode)}
                            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${bladeMode ? 'bg-red-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                            title="Blade Tool (B)"
                        >
                            ✂️ Split
                        </button>
                        <button
                            onClick={() => setSnapEnabled(!snapEnabled)}
                            className={`px-3 py-1.5 rounded text-xs font-semibold transition ${snapEnabled ? 'bg-blue-500 text-white' : 'bg-white/5 text-white/60 hover:bg-white/10'}`}
                            title="Toggle Snap (N)"
                        >
                            🧲 Snap
                        </button>
                    </div>
                </div>

                <div className="flex items-center gap-3">
                    {/* Clipboard indicator */}
                    {clipboard && (
                        <div className="text-[10px] text-green-400 bg-green-500/10 px-2 py-1 rounded">
                            📋 Clip copied
                        </div>
                    )}

                    {/* Zoom */}
                    <div className="flex items-center gap-1 bg-white/5 rounded-lg p-1">
                        <button onClick={() => setZoom(z => Math.max(0.25, z - 0.25))} className="w-6 h-6 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded">−</button>
                        <span className="text-[10px] text-white/50 w-12 text-center">{Math.round(zoom * 100)}%</span>
                        <button onClick={() => setZoom(z => Math.min(3, z + 0.25))} className="w-6 h-6 text-xs text-white/60 hover:text-white hover:bg-white/10 rounded">+</button>
                    </div>

                    {/* Shortcuts */}
                    <div className="text-[9px] text-white/30 hidden xl:flex gap-2">
                        <span>S: Split</span>
                        <span>N: Snap</span>
                        <span>⌘C/V: Copy/Paste</span>
                    </div>
                </div>
            </div>

            {/* Time Ruler */}
            <div className="h-5 border-b border-white/5 bg-black/20 relative overflow-hidden">
                <div
                    className="absolute h-full flex"
                    style={{ width: `${totalDuration * pixelsPerSecond + 100}px` }}
                >
                    {timeMarkers.map(t => (
                        <div
                            key={t}
                            className="absolute h-full flex flex-col items-center"
                            style={{ left: `${t * pixelsPerSecond}px` }}
                        >
                            <div className="w-px h-2 bg-white/20" />
                            <span className="text-[9px] text-white/30 font-mono">{Math.floor(t / 60)}:{(t % 60).toString().padStart(2, '0')}</span>
                        </div>
                    ))}
                </div>
            </div>

            {/* Tracks Area */}
            <div
                ref={scrollContainerRef}
                className="flex-1 overflow-x-auto custom-scrollbar relative"
                onClick={handleTrackClick}
            >
                <div
                    ref={tracksRef}
                    className="h-full flex items-center gap-0 p-3 relative"
                    style={{ width: `${Math.max(totalDuration * pixelsPerSecond + 150, 800)}px` }}
                >
                    {/* Playhead */}
                    <div
                        className="absolute top-0 bottom-0 w-0.5 bg-red-500 z-30 cursor-ew-resize group"
                        style={{ left: `${playheadPosition + 12}px` }}
                        onMouseDown={handlePlayheadMouseDown}
                    >
                        <div className="absolute -top-1 left-1/2 -translate-x-1/2 w-3 h-3 bg-red-500 rotate-45 group-hover:scale-125 transition" />
                        <div className="absolute top-0 left-1/2 -translate-x-1/2 w-4 h-full bg-transparent" />
                    </div>

                    {/* Clips */}
                    {media.map((clip, index) => {
                        const isSelected = selectedIndex === index;
                        const isDragging = draggedIndex === index;
                        const { effectiveDuration } = clipData[index];
                        const width = Math.max(60, effectiveDuration * pixelsPerSecond);

                        const isTrimmed = (clip.startTime && clip.startTime > 0) ||
                            (clip.endTime && clip.endTime < (clip.duration || 3));
                        const hasSpeedChange = clip.playbackRate && clip.playbackRate !== 1;

                        return (
                            <div key={clip.previewUrl + index} className="flex items-center shrink-0">
                                <div
                                    draggable={!bladeMode}
                                    onDragStart={(e) => handleDragStart(e, index)}
                                    onDragOver={handleDragOver}
                                    onDrop={(e) => handleDrop(e, index)}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (bladeMode) {
                                            handleClipBladeClick(e, index);
                                        } else {
                                            onSelect(index);
                                        }
                                    }}
                                    onContextMenu={(e) => handleContextMenu(e, index)}
                                    className={`
                                        relative group transition-all duration-150
                                        ${bladeMode ? 'cursor-crosshair' : 'cursor-pointer'}
                                        ${isDragging ? 'opacity-50 scale-95' : 'opacity-100'}
                                        ${isSelected ? 'ring-2 ring-insta-mid z-10' : 'hover:ring-1 hover:ring-white/30'}
                                    `}
                                    style={{ width: `${width}px`, height: '90px' }}
                                >
                                    <div className="absolute inset-0 rounded-lg overflow-hidden bg-white/5 border border-white/10">
                                        {/* Thumbnails */}
                                        <div className="absolute inset-0 flex opacity-50">
                                            {[...Array(Math.max(1, Math.ceil(width / 50)))].map((_, i) => (
                                                <img key={i} src={getMediaDisplayUrl(clip)} className="h-full w-[50px] object-cover" alt="" />
                                            ))}
                                        </div>

                                        {/* Blade mode overlay */}
                                        {bladeMode && (
                                            <div className="absolute inset-0 bg-red-500/10 border-2 border-dashed border-red-500/50" />
                                        )}

                                        {/* Info overlay */}
                                        <div className="absolute inset-0 bg-gradient-to-b from-black/60 via-transparent to-black/60 p-2 flex flex-col justify-between">
                                            <div className="flex justify-between items-start">
                                                <span className="text-[10px] font-bold text-white drop-shadow">{index + 1}</span>
                                                <div className="flex items-center gap-1">
                                                    {hasSpeedChange && <span className="text-[9px] px-1 bg-blue-500/80 rounded font-bold">{clip.playbackRate}x</span>}
                                                    {isTrimmed && <span className="text-[9px] text-orange-400">✂️</span>}
                                                    {clip.type === 'video' && <span className="text-[10px]">🎥</span>}
                                                </div>
                                            </div>
                                            <div className={`text-[10px] font-mono text-right ${isTrimmed ? 'text-orange-300' : 'text-white/70'}`}>
                                                {effectiveDuration.toFixed(1)}s
                                            </div>
                                        </div>

                                        {/* Delete button */}
                                        {onDelete && media.length > 1 && !bladeMode && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onDelete(index); }}
                                                className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-500/80 text-white text-[10px] opacity-0 group-hover:opacity-100 transition flex items-center justify-center"
                                            >×</button>
                                        )}

                                        {isSelected && <div className="absolute inset-0 bg-insta-mid/15 pointer-events-none" />}
                                    </div>
                                </div>

                                {/* Transition */}
                                {index < media.length - 1 && (
                                    <button
                                        onClick={(e) => cycleTransition(index, e)}
                                        className="w-5 h-5 -mx-2.5 z-20 rounded-full bg-[#1A1D26] border border-white/20 flex items-center justify-center text-[9px] hover:scale-110 hover:bg-white hover:text-black transition shadow-lg"
                                    >
                                        {getTransitionIcon(media[index].transitionEffect)}
                                    </button>
                                )}
                            </div>
                        );
                    })}

                    {/* Add button */}
                    <div
                        onClick={(e) => { e.stopPropagation(); onAddClips?.(); }}
                        className="w-20 h-[90px] rounded-lg border border-dashed border-white/10 flex flex-col items-center justify-center text-white/20 hover:text-white/50 hover:border-white/30 hover:bg-white/5 transition cursor-pointer ml-2 shrink-0"
                    >
                        <span className="text-xl">+</span>
                        <span className="text-[8px]">Add</span>
                    </div>
                </div>
            </div>

            {/* Context Menu */}
            {contextMenu && (
                <div
                    className="fixed z-50 bg-[#1A1D26] border border-white/20 rounded-lg shadow-xl py-1 min-w-[150px]"
                    style={{ left: contextMenu.x, top: contextMenu.y }}
                >
                    <button onClick={() => { onCopy?.(media[contextMenu.index]); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm text-white/80 hover:bg-white/10 flex items-center gap-2">
                        <span>📋</span> Copy <span className="ml-auto text-[10px] text-white/40">⌘C</span>
                    </button>
                    {clipboard && (
                        <button onClick={() => { onPaste?.(contextMenu.index); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm text-white/80 hover:bg-white/10 flex items-center gap-2">
                            <span>📥</span> Paste After <span className="ml-auto text-[10px] text-white/40">⌘V</span>
                        </button>
                    )}
                    <button onClick={() => { onDuplicate?.(contextMenu.index); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm text-white/80 hover:bg-white/10 flex items-center gap-2">
                        <span>📄</span> Duplicate <span className="ml-auto text-[10px] text-white/40">⌘D</span>
                    </button>
                    {onSplit && (
                        <button
                            onClick={() => {
                                const mid = clipData[contextMenu.index].effectiveDuration / 2;
                                onSplit(contextMenu.index, mid);
                                setContextMenu(null);
                            }}
                            className="w-full px-4 py-2 text-left text-sm text-white/80 hover:bg-white/10 flex items-center gap-2"
                        >
                            <span>✂️</span> Split in Half <span className="ml-auto text-[10px] text-white/40">S</span>
                        </button>
                    )}
                    <div className="h-px bg-white/10 my-1" />
                    {onDelete && media.length > 1 && (
                        <button onClick={() => { onDelete(contextMenu.index); setContextMenu(null); }} className="w-full px-4 py-2 text-left text-sm text-red-400 hover:bg-red-500/20 flex items-center gap-2">
                            <span>🗑️</span> Delete <span className="ml-auto text-[10px] text-white/40">Del</span>
                        </button>
                    )}
                </div>
            )}
        </div>
    );
};

export default Timeline;
