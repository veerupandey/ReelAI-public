import React, { useEffect, useMemo, useRef, useState } from 'react';
import { CaptionBlock, ReelScript, ScenePacingRole, UploadedMedia, TransitionEffect } from '../types';
import {
  getEffectiveStoryboardRoute,
  getMediaDisplayUrl,
  type VoiceSlotMeter,
} from '../utils/sceneDrafts';
import Timeline from './Timeline';
import { getScriptStudioRouteLabel, getScriptStudioRouteTone, getScriptStudioSourceModeLabel } from './ScriptStudio/scriptStudioViewUtils';

export type BulkDurationMode = 'all' | 'fromHere' | 'equalSplitAll' | 'equalSplitFromHere';
export type DurationEditMode = 'ripple' | 'solo';

interface VideoExtensionStudioProps {
  media: UploadedMedia[];
  script: ReelScript | null;
  onBack: () => void;
  onUpdateMedia: (media: UploadedMedia[]) => void;
  onContinue: () => void;
  onUpdateDuration?: (index: number, duration: number) => void;
  onBulkUpdateDuration?: (mode: BulkDurationMode, index: number, duration: number) => void;
  onFitDurationsToTarget?: () => void;
  onFitTimelineToMeasuredVoice?: () => void;
  onApplyRolePreset?: (index: number, role: 'hook' | 'body' | 'cta') => void;
  onSetPacingRole?: (index: number, role: ScenePacingRole) => void;
  onTogglePacingLock?: (index: number) => void;
  onRippleDurationChange?: (index: number, duration: number) => void;
  onRegenerateVoice?: () => void;
  isGeneratingAudio?: boolean;
  pacingScenes?: VoiceSlotMeter[];
  targetDuration?: number;
  voiceStretchExtreme?: boolean;
  onExport?: () => void;
  initialSelectedIndex?: number;
}

const ROLE_BAR_CLASS: Record<ScenePacingRole, string> = {
  hook: 'bg-sky-500/70',
  body: 'bg-violet-500/60',
  cta: 'bg-amber-500/70',
  other: 'bg-white/30',
};

const METER_STATUS_CLASS: Record<VoiceSlotMeter['status'], string> = {
  ok: 'text-emerald-200/90',
  tight: 'text-amber-200/90',
  extreme: 'text-rose-200/90',
  missing: 'text-white/45',
};

const MIN_RATE = 0.25;
const MAX_RATE = 5;
const MIN_DURATION = 0.7;
const MAX_DURATION = 30;

const getId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `cap-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const getClipId = () => {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  return `scene-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
};

const getSceneDuration = (clip?: UploadedMedia): number => {
  if (!clip) return MIN_DURATION;
  const extended = typeof clip.extendedDuration === 'number' && Number.isFinite(clip.extendedDuration)
    ? clip.extendedDuration
    : undefined;
  const end = typeof clip.endTime === 'number' ? clip.endTime : undefined;
  const start = typeof clip.startTime === 'number' ? clip.startTime : 0;
  const trimmed = end !== undefined ? end - start : undefined;
  const base = extended ?? (trimmed && trimmed > 0 ? trimmed : clip.duration);
  return Math.max(MIN_DURATION, Math.min(MAX_DURATION, base || MIN_DURATION));
};

const retimeCaptions = (captions: CaptionBlock[] | undefined, fromDuration: number, toDuration: number): CaptionBlock[] | undefined => {
  if (!captions?.length) return captions;
  const safeFrom = Math.max(MIN_DURATION, fromDuration || MIN_DURATION);
  const safeTo = Math.max(MIN_DURATION, toDuration || MIN_DURATION);
  const scale = safeTo / safeFrom;

  return captions.map((caption) => {
    const nextStart = Math.max(0, Math.min(safeTo, Number((caption.startTime * scale).toFixed(2))));
    const nextEnd = Math.max(nextStart + 0.05, Math.min(safeTo, Number((caption.endTime * scale).toFixed(2))));
    return {
      ...caption,
      startTime: nextStart,
      endTime: nextEnd,
    };
  });
};

const VideoExtensionStudio: React.FC<VideoExtensionStudioProps> = ({
  media,
  script,
  onBack,
  onUpdateMedia,
  onContinue,
  onUpdateDuration,
  onBulkUpdateDuration,
  onFitDurationsToTarget,
  onFitTimelineToMeasuredVoice,
  onApplyRolePreset,
  onSetPacingRole,
  onTogglePacingLock,
  onRippleDurationChange,
  onRegenerateVoice,
  isGeneratingAudio = false,
  pacingScenes = [],
  targetDuration,
  voiceStretchExtreme = false,
  onExport,
  initialSelectedIndex = 0,
}) => {
  const [selectedIndex, setSelectedIndex] = useState(initialSelectedIndex);
  const [durationEditMode, setDurationEditMode] = useState<DurationEditMode>(
    typeof targetDuration === 'number' && targetDuration > 0 ? 'ripple' : 'solo',
  );
  const selectedClip = media[selectedIndex];
  const selectedSceneDuration = useMemo(() => getSceneDuration(selectedClip), [selectedClip]);
  const selectedPacing = pacingScenes[selectedIndex];
  const totalTimelineSec = useMemo(
    () => media.reduce((sum, clip) => sum + getSceneDuration(clip), 0),
    [media],
  );
  const effectiveTarget = typeof targetDuration === 'number' && targetDuration > 0 ? targetDuration : 0;
  const targetDriftSec = effectiveTarget > 0
    ? Math.abs(totalTimelineSec - effectiveTarget)
    : 0;
  const measuredTimelineMinimumSec = useMemo(
    () => pacingScenes.reduce(
      (sum, scene) => sum + (typeof scene.voiceSec === 'number' && scene.voiceSec > 0.05
        ? scene.voiceSec
        : MIN_DURATION),
      0,
    ),
    [pacingScenes],
  );
  const targetImpossible = effectiveTarget > 0
    && pacingScenes.length > 0
    && measuredTimelineMinimumSec > effectiveTarget + 0.05;
  const hasLockedVoiceConflict = pacingScenes.some(
    (scene) => scene.pacingLocked
      && typeof scene.voiceSec === 'number'
      && scene.voiceSec > scene.slotSec + 0.05,
  );
  const timingConstraintImpossible = targetImpossible || hasLockedVoiceConflict;
  const hasTargetDrift = effectiveTarget > 0 && targetDriftSec > 0.15;
  const maxSlotForGraph = useMemo(
    () => Math.max(1, ...pacingScenes.map((scene) => scene.slotSec), ...media.map((clip) => getSceneDuration(clip))),
    [pacingScenes, media],
  );

  const segmentScript = useMemo(() => script?.segments[selectedIndex] || '', [script, selectedIndex]);
  const clipPlayableDuration = useMemo(() => {
    if (!selectedClip) return MIN_DURATION;
    const start = selectedClip.startTime || 0;
    const explicitEnd = typeof selectedClip.endTime === 'number' ? selectedClip.endTime : undefined;
    const baseDuration = explicitEnd !== undefined ? explicitEnd - start : (selectedClip.duration || MIN_DURATION);
    return Math.max(MIN_DURATION, baseDuration);
  }, [selectedClip]);
  const totalSourceDuration = selectedClip?.duration || clipPlayableDuration;
  const trimStart = selectedClip?.startTime || 0;
  const trimEnd = typeof selectedClip?.endTime === 'number' ? selectedClip.endTime : totalSourceDuration;
  const timelineRef = useRef<HTMLDivElement | null>(null);
  const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const [scrubTime, setScrubTime] = useState(0);
  const selectedClipRoute = useMemo(
    () => selectedClip ? getEffectiveStoryboardRoute(selectedClip) : undefined,
    [selectedClip],
  );
  const selectedClipExpectedAssetId = selectedClip?.storyboardLinkedAssetId || selectedClip?.storyboardBaseAssetId;
  const selectedClipContinuityWarning = useMemo(() => {
    if (!selectedClip) return null;
    const isExactAssetScene = selectedClipRoute === 'use_existing'
      || selectedClip.storyboardSourceMode === 'use_exact_asset'
      || selectedClip.storyboardSourceMode === 'crop_reframe_asset';
    if (!isExactAssetScene) return null;

    if (selectedClipExpectedAssetId && selectedClip.brandAssetId !== selectedClipExpectedAssetId) {
      return 'This scene was approved as an exact or reframed asset shot, but the current clip is no longer tied to the approved product asset.';
    }

    if (!selectedClipExpectedAssetId && selectedClip.assetOrigin !== 'brand_asset') {
      return 'This scene was approved as a real product shot. The current clip is no longer coming from the approved product asset lane.';
    }

    if (selectedClipExpectedAssetId && selectedClip.assetOrigin !== 'brand_asset' && selectedClip.assetOrigin !== 'brand_edit') {
      return 'This scene started from a locked product asset. Keep the approved product visible if you replace or extend this clip.';
    }

    return null;
  }, [selectedClip, selectedClipExpectedAssetId, selectedClipRoute]);

  const updateClip = (partial: Partial<UploadedMedia>) => {
    if (!selectedClip) return;
    const updated = media.map((item, idx) => idx === selectedIndex ? { ...item, ...partial } : item);
    onUpdateMedia(updated);
  };

  const updateCaptions = (caps: CaptionBlock[]) => {
    updateClip({ captions: caps });
  };

  const handlePlaybackRate = (value: number) => {
    updateClip({ playbackRate: Number(value.toFixed(2)) });
  };

  const handleDurationChange = (value: number) => {
    const safe = Math.max(MIN_DURATION, Math.min(MAX_DURATION, value));
    const currentDuration = getSceneDuration(selectedClip);
    updateClip({
      duration: safe,
      extendedDuration: safe,
      captions: retimeCaptions(selectedClip?.captions, currentDuration, safe),
    });
    if (selectedIndex < 0) return;
    if (
      durationEditMode === 'ripple'
      && effectiveTarget > 0
      && onRippleDurationChange
      && !selectedPacing?.pacingLocked
    ) {
      onRippleDurationChange(selectedIndex, safe);
      return;
    }
    onUpdateDuration?.(selectedIndex, safe);
  };

  const handleApplyDurationAll = (mode: BulkDurationMode) => {
    if (selectedIndex < 0 || !selectedClip) return;
    const target = Math.max(MIN_DURATION, Math.min(MAX_DURATION, selectedClip.extendedDuration || selectedClip.duration || MIN_DURATION));
    onBulkUpdateDuration?.(mode, selectedIndex, target);
  };

  const handleHoldStrategy = (strategy: 'freeze' | 'loop' | 'slowmo') => {
    updateClip({ holdFrameStrategy: strategy });
  };

  const handleAnchorChange = (value: number) => {
    const safeAnchor = Math.min(Math.max(0, value), clipPlayableDuration);
    updateClip({ extensionAnchor: safeAnchor });
  };

  const handleLoopDurationChange = (value: number) => {
    const safeLoop = Math.min(Math.max(0.3, value), clipPlayableDuration);
    updateClip({ extensionLoopDuration: safeLoop });
  };

  const handleTrimChange = (field: 'start' | 'end', value: number) => {
    if (!selectedClip) return;
    const sourceDuration = selectedClip.duration || MIN_DURATION;
    let start = selectedClip.startTime || 0;
    let end = typeof selectedClip.endTime === 'number' ? selectedClip.endTime : sourceDuration;

    if (field === 'start') {
      start = Math.min(Math.max(0, value), end - 0.1);
    } else {
      end = Math.max(Math.min(sourceDuration, value), start + 0.1);
    }

    const playbackRate = selectedClip.playbackRate || 1;
    const visibleDuration = Math.max(MIN_DURATION, Math.min(MAX_DURATION, Number(((end - start) / playbackRate).toFixed(2))));
    const currentDuration = getSceneDuration(selectedClip);

    updateClip({
      startTime: Number(start.toFixed(2)),
      endTime: Number(end.toFixed(2)),
      duration: visibleDuration,
      extendedDuration: visibleDuration,
      captions: retimeCaptions(selectedClip.captions, currentDuration, visibleDuration),
    });

    if (selectedIndex >= 0) {
      onUpdateDuration?.(selectedIndex, visibleDuration);
    }
  };

  const updateScrubFromClientX = (clientX: number, targetHandle?: 'start' | 'end') => {
    if (!timelineRef.current || !selectedClip) return;
    const rect = timelineRef.current.getBoundingClientRect();
    const ratio = Math.min(Math.max((clientX - rect.left) / rect.width, 0), 1);
    const time = ratio * totalSourceDuration;
    setScrubTime(time);
    if (targetHandle) {
      handleTrimChange(targetHandle, time);
    }
  };

  useEffect(() => {
    setScrubTime(trimStart);
  }, [trimStart, selectedIndex]);

  useEffect(() => {
    if (!draggingHandle) return;
    const handleMove = (e: MouseEvent) => updateScrubFromClientX(e.clientX, draggingHandle);
    const handleUp = () => setDraggingHandle(null);
    document.addEventListener('mousemove', handleMove);
    document.addEventListener('mouseup', handleUp);
    return () => {
      document.removeEventListener('mousemove', handleMove);
      document.removeEventListener('mouseup', handleUp);
    };
  }, [draggingHandle]);

  const handleAddCaption = (preset?: 'script' | 'blank') => {
    if (!selectedClip) return;
    const baseText = preset === 'blank' ? '' : (segmentScript || 'New caption');
    const newBlock: CaptionBlock = {
      id: getId(),
      text: baseText,
      startTime: 0,
      endTime: selectedSceneDuration,
      position: 'bottom',
      stylePreset: 'bold-pop',
      fontSize: 28,
      color: '#FFFFFF',
    };
    const existing = selectedClip.captions || [];
    updateCaptions([...existing, newBlock]);
  };

  const handleCaptionChange = (captionId: string, partial: Partial<CaptionBlock>) => {
    if (!selectedClip?.captions) return;
    const updated = selectedClip.captions.map(cap => cap.id === captionId ? { ...cap, ...partial } : cap);
    updateCaptions(updated);
  };

  const handleDeleteCaption = (captionId: string) => {
    if (!selectedClip?.captions) return;
    updateCaptions(selectedClip.captions.filter(cap => cap.id !== captionId));
  };

  const handleReorder = (fromIndex: number, toIndex: number) => {
    const newMedia = [...media];
    const [movedItem] = newMedia.splice(fromIndex, 1);
    newMedia.splice(toIndex, 0, movedItem);
    onUpdateMedia(newMedia);
    setSelectedIndex(toIndex);
  };

  const handleTransitionChange = (index: number, transition: TransitionEffect) => {
    const newMedia = [...media];
    newMedia[index] = { ...newMedia[index], transitionEffect: transition };
    onUpdateMedia(newMedia);
  };

  // Playback state for preview
  const [isPlaying, setIsPlaying] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);

  const handlePlayToggle = () => {
    setIsPlaying(!isPlaying);
    if (videoRef.current) {
      if (isPlaying) {
        videoRef.current.pause();
      } else {
        videoRef.current.play();
      }
    }
  };

  // Sync video playback rate with selectedClip.playbackRate
  useEffect(() => {
    if (videoRef.current && selectedClip?.playbackRate) {
      videoRef.current.playbackRate = selectedClip.playbackRate;
    }
  }, [selectedClip?.playbackRate]);

  // Delete clip from timeline
  const handleDeleteClip = (index: number) => {
    if (media.length <= 1) return; // Keep at least one clip
    const newMedia = media.filter((_, i) => i !== index);
    onUpdateMedia(newMedia);
    // Adjust selected index if needed
    if (selectedIndex >= newMedia.length) {
      setSelectedIndex(newMedia.length - 1);
    } else if (selectedIndex > index) {
      setSelectedIndex(selectedIndex - 1);
    }
  };

  // Duplicate clip
  const handleDuplicateClip = (index: number) => {
    const clipToDuplicate = media[index];
    const sceneId = getClipId();
    const duplicatedClip = {
      ...clipToDuplicate,
      id: sceneId,
      sceneId,
      // Reset some properties for the duplicate
      captions: clipToDuplicate.captions?.map(cap => ({ ...cap, id: getId() })) || [],
    };
    const newMedia = [...media];
    newMedia.splice(index + 1, 0, duplicatedClip);
    onUpdateMedia(newMedia);
    setSelectedIndex(index + 1);
  };

  // Add clips handler (triggers file picker)
  const fileInputRef = useRef<HTMLInputElement>(null);
  const handleAddClips = () => {
    fileInputRef.current?.click();
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (!files || files.length === 0) return;

    const newClips: UploadedMedia[] = await Promise.all(
      Array.from(files).map(async (file: File) => {
        const previewUrl = URL.createObjectURL(file);
        const isVideo = file.type.startsWith('video/');

        let duration = 3;
        if (isVideo) {
          duration = await new Promise<number>((resolve) => {
            const video = document.createElement('video');
            video.preload = 'metadata';
            video.onloadedmetadata = () => {
              resolve(video.duration || 3);
            };
            video.onerror = () => resolve(3);
            video.src = previewUrl;
          });
        }

        const sceneId = getClipId();
        const clip: UploadedMedia = {
          id: sceneId,
          sceneId,
          file,
          previewUrl,
          thumbnailUrl: previewUrl,
          type: isVideo ? 'video' : 'image',
          mimeType: file.type,
          duration,
        };

        return clip;
      })
    );

    onUpdateMedia([...media, ...newClips]);
    // Clear input so same file can be selected again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  // ========== PRO FEATURES ==========

  // Playhead / current time for timeline scrubbing
  const [currentTime, setCurrentTime] = useState(0);

  const handleSeek = (time: number) => {
    setCurrentTime(time);
    // Also update video preview if available
    if (videoRef.current) {
      videoRef.current.currentTime = time;
    }
  };

  // Clipboard for copy/paste
  const [clipboard, setClipboard] = useState<UploadedMedia | null>(null);

  const handleCopyClip = (clip: UploadedMedia) => {
    setClipboard({ ...clip });
  };

  const handlePasteClip = (afterIndex: number) => {
    if (!clipboard) return;
    const sceneId = getClipId();
    const pastedClip = {
      ...clipboard,
      id: sceneId,
      sceneId,
      captions: clipboard.captions?.map(cap => ({ ...cap, id: getId() })) || [],
    };
    const newMedia = [...media];
    newMedia.splice(afterIndex + 1, 0, pastedClip);
    onUpdateMedia(newMedia);
    setSelectedIndex(afterIndex + 1);
  };

  // Split clip at a specific time
  const handleSplitClip = (index: number, splitTime: number) => {
    const clipToSplit = media[index];
    if (!clipToSplit) return;

    const originalStart = clipToSplit.startTime || 0;
    const originalEnd = typeof clipToSplit.endTime === 'number' ? clipToSplit.endTime : (clipToSplit.duration || 3);
    const firstSceneId = getClipId();
    const secondSceneId = getClipId();

    // First part: from original start to split point
    const firstPart: UploadedMedia = {
      ...clipToSplit,
      id: firstSceneId,
      sceneId: firstSceneId,
      startTime: originalStart,
      endTime: originalStart + splitTime,
      captions: [], // Clear captions for split clips
    };

    // Second part: from split point to original end
    const secondPart: UploadedMedia = {
      ...clipToSplit,
      id: secondSceneId,
      sceneId: secondSceneId,
      startTime: originalStart + splitTime,
      endTime: originalEnd,
      captions: [],
    };

    const newMedia = [...media];
    newMedia.splice(index, 1, firstPart, secondPart);
    onUpdateMedia(newMedia);
    setSelectedIndex(index + 1); // Select the second part
  };

  const activeCaptions = selectedClip?.captions || [];

  return (
    <section className="relative h-[calc(100vh-64px)] bg-[#05070F] flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#05070F] z-20">
        <div>
          <h2 className="text-xl font-bold text-white">Post-Production Studio</h2>
          <p className="text-xs text-white/50">Assemble your story, refine clips, and add polish.</p>
        </div>
        <div className="flex gap-3">
          <button onClick={onBack} className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:text-white transition text-sm font-semibold">Back</button>
          <button onClick={onContinue} className="px-5 py-2 rounded-xl bg-white/10 hover:bg-white/20 text-white font-semibold text-sm transition">Preview</button>
          <button id="render-download-btn" onClick={onExport} className="px-6 py-2 rounded-xl bg-gradient-to-r from-insta-purple to-insta-start text-white font-bold text-sm shadow-lg shadow-insta-purple/20 hover:-translate-y-0.5 transition flex items-center gap-2"><span>🚀</span> Render & Download</button>
        </div>
      </div>

      {/* Main Workspace (Split View) */}
      <div className="flex-1 flex min-h-0">
        {/* Left: Inspector / Settings */}
        <div className="w-[400px] border-r border-white/10 overflow-y-auto custom-scrollbar bg-[#080B13] p-6 space-y-6">
          {selectedClip ? (
            <>
              {/* Clip Info */}
              <div className="flex items-center gap-4 pb-4 border-b border-white/5">
                <img
                  src={getMediaDisplayUrl(selectedClip)}
                  className="w-20 h-20 rounded-lg object-cover bg-white/5"
                  alt="Selected clip"
                />
                <div>
                  <p className="text-xs uppercase tracking-widest text-white/40">Selected Clip</p>
                  <h3 className="text-lg font-bold text-white">Scene {selectedIndex + 1}</h3>
                  <p className="text-xs text-white/50 truncate max-w-[200px]">{selectedClip.description || 'No description'}</p>
                </div>
              </div>

              {(selectedClip.productTitle || selectedClip.storyboardRoute || selectedClip.storyboardSourceMode || selectedClip.storyboardBaseAssetDescription || selectedClip.storyboardLinkedAssetDescription) && (
                <div className="rounded-2xl border border-insta-mid/20 bg-gradient-to-r from-insta-start/10 via-white/5 to-insta-purple/10 p-4">
                  <p className="text-[10px] uppercase tracking-[0.35em] text-insta-mid/80 mb-3">Approved Scene Context</p>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {selectedClip.productTitle && (
                      <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] font-semibold text-white/80">
                        {selectedClip.productTitle}
                      </span>
                    )}
                    {selectedClipRoute && (
                      <span className={`rounded-full border px-3 py-1 text-[10px] font-semibold ${getScriptStudioRouteTone(selectedClipRoute)}`}>
                        {getScriptStudioRouteLabel(selectedClipRoute)}
                      </span>
                    )}
                    {selectedClip.storyboardSourceMode && (
                      <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/70">
                        {getScriptStudioSourceModeLabel(selectedClip.storyboardSourceMode)}
                      </span>
                    )}
                  </div>
                  {selectedClip.storyboardBaseAssetDescription && (
                    <p className="text-[11px] text-white/65">
                      Base asset: <span className="text-white/80">{selectedClip.storyboardBaseAssetDescription}</span>
                    </p>
                  )}
                  {selectedClip.storyboardLinkedAssetDescription && selectedClip.storyboardLinkedAssetDescription !== selectedClip.storyboardBaseAssetDescription && (
                    <p className="mt-1 text-[11px] text-white/65">
                      Selected variant: <span className="text-white/80">{selectedClip.storyboardLinkedAssetDescription}</span>
                    </p>
                  )}
                  {selectedClip.storyboardDirectorsNote && (
                    <p className="mt-2 text-[11px] text-amber-200/80">
                      Director note: {selectedClip.storyboardDirectorsNote}
                    </p>
                  )}
                </div>
              )}

              {selectedClipContinuityWarning && (
                <div className="rounded-2xl border border-amber-500/20 bg-amber-500/10 px-4 py-3">
                  <p className="text-[10px] uppercase tracking-[0.3em] text-amber-200/80 mb-1">Continuity Warning</p>
                  <p className="text-xs text-amber-100/85 leading-relaxed">{selectedClipContinuityWarning}</p>
                </div>
              )}

              {/* Timing Controls */}
              <div className="space-y-4">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold text-white">Timing & Trim</p>
                  <div className="flex items-center gap-2">
                    {selectedPacing && (
                      <span className="rounded-full border border-white/15 bg-black/30 px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wider text-white/80">
                        {selectedPacing.role}
                        {selectedPacing.pacingLocked ? ' · locked' : ''}
                      </span>
                    )}
                    {effectiveTarget > 0 && (
                      <span
                        className={`rounded-full border px-3 py-1 text-[10px] font-semibold font-mono ${
                          hasTargetDrift
                            ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                            : 'border-emerald-400/30 bg-emerald-500/10 text-emerald-100'
                        }`}
                        title="Timeline total vs topic target"
                      >
                        {totalTimelineSec.toFixed(1)}s / {effectiveTarget}s
                      </span>
                    )}
                  </div>
                </div>

                {pacingScenes.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] uppercase tracking-wider text-white/40">Pacing</p>
                    <div className="flex items-end gap-1 h-12">
                      {pacingScenes.map((scene) => {
                        const heightPct = Math.max(18, (scene.slotSec / maxSlotForGraph) * 100);
                        const voicePct = scene.voiceSec
                          ? Math.min(100, (scene.voiceSec / maxSlotForGraph) * 100)
                          : 0;
                        return (
                          <button
                            key={`pace-${scene.index}`}
                            type="button"
                            onClick={() => setSelectedIndex(scene.index)}
                            className={`relative flex-1 min-w-0 rounded-t transition border ${
                              scene.index === selectedIndex
                                ? 'border-white/40'
                                : 'border-transparent hover:border-white/20'
                            }`}
                            style={{ height: `${heightPct}%` }}
                            title={`Scene ${scene.index + 1}: ${scene.role} ${scene.slotSec.toFixed(1)}s${scene.voiceSec ? ` · VO ${scene.voiceSec.toFixed(1)}s` : ''}`}
                          >
                            <div className={`absolute inset-0 rounded-t ${ROLE_BAR_CLASS[scene.role]}`} />
                            {scene.voiceSec ? (
                              <div
                                className="absolute bottom-0 left-0 right-0 bg-white/35 rounded-t"
                                style={{ height: `${Math.min(100, (voicePct / heightPct) * 100)}%` }}
                              />
                            ) : null}
                            {scene.pacingLocked && (
                              <span className="absolute top-0.5 right-0.5 text-[8px] text-white/90">L</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                    <div className="flex gap-1">
                      {pacingScenes.map((scene) => (
                        <span
                          key={`meter-${scene.index}`}
                          className={`flex-1 text-center text-[9px] font-mono ${METER_STATUS_CLASS[scene.status]}`}
                        >
                          {scene.status === 'missing' ? '—' : scene.status === 'ok' ? 'ok' : scene.status}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {selectedPacing && (
                  <div className="rounded-xl border border-white/10 bg-black/25 px-3 py-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className={`text-[11px] font-mono ${METER_STATUS_CLASS[selectedPacing.status]}`}>
                        {typeof selectedPacing.voiceSec === 'number'
                          ? `VO ${selectedPacing.voiceSec.toFixed(1)}s → slot ${selectedPacing.slotSec.toFixed(1)}s`
                          : `Slot ${selectedPacing.slotSec.toFixed(1)}s · no VO yet`}
                      </p>
                      {(selectedPacing.status === 'extreme' || selectedPacing.status === 'tight') && onRegenerateVoice && (
                        <button
                          type="button"
                          onClick={onRegenerateVoice}
                          disabled={isGeneratingAudio}
                          className="text-[10px] font-semibold text-amber-100 hover:text-white underline-offset-2 hover:underline disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isGeneratingAudio ? 'Generating…' : 'Regen VO'}
                        </button>
                      )}
                    </div>
                    {typeof selectedPacing.voiceSec === 'number' && selectedPacing.voiceSec > 0 && (
                      <div className="h-1.5 rounded-full bg-white/10 overflow-hidden relative">
                        <div
                          className="absolute inset-y-0 left-0 bg-white/25"
                          style={{ width: '100%' }}
                        />
                        <div
                          className={`absolute inset-y-0 left-0 ${
                            selectedPacing.status === 'extreme'
                              ? 'bg-rose-400/80'
                              : selectedPacing.status === 'tight'
                                ? 'bg-amber-400/80'
                                : 'bg-emerald-400/70'
                          }`}
                          style={{
                            width: `${Math.min(100, (selectedPacing.voiceSec / Math.max(selectedPacing.slotSec, selectedPacing.voiceSec)) * 100)}%`,
                          }}
                        />
                      </div>
                    )}
                  </div>
                )}

                {(voiceStretchExtreme || hasTargetDrift) && (onFitTimelineToMeasuredVoice || onRegenerateVoice) && (
                  <div className="rounded-xl border border-amber-500/20 bg-amber-500/10 px-3 py-2 flex items-center justify-between gap-3">
                    <p className="text-[11px] text-amber-100/90 leading-relaxed">
                      {targetImpossible
                        ? `Clean narration needs at least ${measuredTimelineMinimumSec.toFixed(1)}s for the ${effectiveTarget}s target. Keep the longer timeline, or shorten the script and regenerate; audio remains unchanged.`
                        : hasLockedVoiceConflict
                          ? 'A locked scene is shorter than its narration. Unlock it before fitting; the voice and locked duration remain unchanged.'
                        : voiceStretchExtreme
                        ? onFitTimelineToMeasuredVoice
                          ? 'Voice is longer than some scene slots. Fit the timeline to your measured voice, or regenerate voice for shorter lines.'
                          : 'Voice stretch would be extreme for some scenes. Regenerate voice to fit the timeline.'
                        : `Timeline is off the ${effectiveTarget}s target. Fit to target; Ripple keeps this edit fixed and rebalances other unlocked scenes.`}
                    </p>
                    <div className="shrink-0 flex flex-col gap-1.5">
                      {voiceStretchExtreme && !targetImpossible && onFitTimelineToMeasuredVoice && (
                        <button
                          type="button"
                          onClick={onFitTimelineToMeasuredVoice}
                          className="text-[11px] font-semibold bg-amber-400/20 hover:bg-amber-400/30 text-amber-50 rounded-lg px-2.5 py-1.5 border border-amber-300/30 transition"
                        >
                          Fit timeline to voice
                        </button>
                      )}
                      {onRegenerateVoice && (
                        <button
                          type="button"
                          onClick={onRegenerateVoice}
                          disabled={isGeneratingAudio}
                          className="text-[11px] font-semibold bg-white/10 hover:bg-white/15 text-amber-50 rounded-lg px-2.5 py-1.5 border border-white/15 transition disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          {isGeneratingAudio ? 'Generating voice…' : 'Regenerate voice to fit'}
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {/* Trim Slider */}
                <div>
                  <div className="flex justify-between text-[10px] uppercase tracking-wider text-white/40 mb-2">
                    <span>In Point</span>
                    <span>Out Point</span>
                  </div>
                  <div
                    ref={timelineRef}
                    className="relative h-8 rounded-lg bg-white/5 border border-white/10 cursor-pointer mb-2"
                    onMouseDown={(e) => updateScrubFromClientX(e.clientX)}
                  >
                    <div
                      className="absolute top-0 bottom-0 bg-insta-mid/20 border-x border-insta-mid"
                      style={{
                        left: `${(trimStart / totalSourceDuration) * 100}%`,
                        right: `${100 - (trimEnd / totalSourceDuration) * 100}%`,
                      }}
                    ></div>
                    {/* Handles */}
                    <div
                      className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex items-center justify-center group"
                      style={{ left: `${(trimStart / totalSourceDuration) * 100}%` }}
                      onMouseDown={(e) => { e.stopPropagation(); setDraggingHandle('start'); }}
                    >
                      <div className="w-1 h-4 bg-white rounded-full group-hover:scale-125 transition" />
                    </div>
                    <div
                      className="absolute top-0 bottom-0 w-4 -ml-2 cursor-ew-resize flex items-center justify-center group"
                      style={{ left: `${(trimEnd / totalSourceDuration) * 100}%` }}
                      onMouseDown={(e) => { e.stopPropagation(); setDraggingHandle('end'); }}
                    >
                      <div className="w-1 h-4 bg-white rounded-full group-hover:scale-125 transition" />
                    </div>
                  </div>
                  <div className="flex justify-between text-xs text-white/50 font-mono">
                    <span>{trimStart.toFixed(1)}s</span>
                    <span>{trimEnd.toFixed(1)}s</span>
                  </div>
                </div>

                {/* Duration & Speed */}
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <label className="text-[10px] uppercase tracking-wider text-white/40">Duration</label>
                      {effectiveTarget > 0 && onRippleDurationChange && (
                        <div className="flex rounded border border-white/10 overflow-hidden text-[10px]">
                          <button
                            type="button"
                            onClick={() => setDurationEditMode('ripple')}
                            className={`px-2 py-0.5 ${durationEditMode === 'ripple' ? 'bg-insta-mid/40 text-white' : 'bg-black/30 text-white/55'}`}
                            title="Edit this clip and rebalance unlocked clips to hit target"
                          >
                            Ripple
                          </button>
                          <button
                            type="button"
                            onClick={() => setDurationEditMode('solo')}
                            className={`px-2 py-0.5 ${durationEditMode === 'solo' ? 'bg-insta-mid/40 text-white' : 'bg-black/30 text-white/55'}`}
                            title="Edit only this clip"
                          >
                            Solo
                          </button>
                        </div>
                      )}
                    </div>
                    <input
                      type="number"
                      min={MIN_DURATION}
                      max={MAX_DURATION}
                      step={0.1}
                      value={selectedSceneDuration.toFixed(1)}
                      onChange={(e) => handleDurationChange(Number(e.target.value))}
                      disabled={Boolean(selectedPacing?.pacingLocked)}
                      className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm disabled:opacity-50"
                    />
                    {onFitDurationsToTarget && effectiveTarget > 0 && (
                      <button
                        type="button"
                        onClick={onFitDurationsToTarget}
                        disabled={timingConstraintImpossible}
                        className="mt-2 w-full text-[11px] bg-insta-mid/30 hover:bg-insta-mid/45 text-white rounded px-2 py-1 border border-insta-mid/40 transition disabled:cursor-not-allowed disabled:opacity-45"
                        title={timingConstraintImpossible
                          ? hasLockedVoiceConflict
                            ? 'Unlock the scene whose narration exceeds its locked duration'
                            : 'Clean narration is longer than the target; shorten the script or raise the target first'
                          : 'Role-weighted redistribution of unlocked clips to target'}
                      >
                        {hasLockedVoiceConflict
                          ? 'Unlock scene before fitting'
                          : targetImpossible
                            ? 'Target needs shorter narration'
                            : 'Fit to target'}
                      </button>
                    )}
                    {(onTogglePacingLock || onSetPacingRole || onApplyRolePreset || onBulkUpdateDuration) && (
                      <details className="mt-2 rounded-lg border border-white/10 bg-black/20">
                        <summary className="cursor-pointer select-none px-2 py-1.5 text-[10px] uppercase tracking-wider text-white/50">
                          Advanced timing
                        </summary>
                        <div className="border-t border-white/10 p-2 space-y-2">
                          <p className="text-[10px] leading-relaxed text-white/45">
                            Ripple keeps the edited or locked scene fixed, then redistributes time across other unlocked scenes.
                          </p>
                          {onTogglePacingLock && (
                          <button
                            type="button"
                            onClick={() => onTogglePacingLock(selectedIndex)}
                            className={`w-full text-[11px] rounded px-2 py-1 border transition ${
                              selectedPacing?.pacingLocked
                                ? 'border-amber-400/40 bg-amber-500/15 text-amber-100'
                                : 'border-white/10 bg-white/5 text-white/75'
                            }`}
                          >
                            {selectedPacing?.pacingLocked ? 'Unlock scene duration' : 'Lock scene duration'}
                          </button>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            <button type="button" onClick={() => handleApplyDurationAll('all')} className="text-[11px] bg-white/5 hover:bg-white/15 rounded px-2 py-1 border border-white/10">Same → All</button>
                            <button type="button" onClick={() => handleApplyDurationAll('fromHere')} className="text-[11px] bg-white/5 hover:bg-white/15 rounded px-2 py-1 border border-white/10">Same → Here</button>
                            {onBulkUpdateDuration && effectiveTarget > 0 && (
                              <>
                                <button type="button" onClick={() => handleApplyDurationAll('equalSplitAll')} className="text-[11px] bg-white/5 hover:bg-white/15 rounded px-2 py-1 border border-white/10">Equal split</button>
                                <button type="button" onClick={() => handleApplyDurationAll('equalSplitFromHere')} className="text-[11px] bg-white/5 hover:bg-white/15 rounded px-2 py-1 border border-white/10">Equal → Here</button>
                              </>
                            )}
                          </div>
                          {(onSetPacingRole || onApplyRolePreset) && (
                            <div className="space-y-1.5">
                              <p className="text-[10px] uppercase tracking-wider text-white/40">Role</p>
                              <div className="flex gap-2">
                                {(['hook', 'body', 'cta'] as const).map((role) => (
                                  <button
                                    key={role}
                                    type="button"
                                    onClick={() => onSetPacingRole?.(selectedIndex, role)}
                                    className={`flex-1 text-[11px] capitalize rounded px-2 py-1 border ${
                                      selectedPacing?.role === role ? 'bg-white/20 border-white/30' : 'bg-white/5 border-white/10'
                                    }`}
                                  >
                                    {role}
                                  </button>
                                ))}
                              </div>
                              {onApplyRolePreset && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const role = (selectedPacing?.role === 'other' ? 'body' : selectedPacing?.role) || 'body';
                                    if (role === 'hook' || role === 'body' || role === 'cta') onApplyRolePreset(selectedIndex, role);
                                  }}
                                  className="w-full text-[11px] bg-white/5 hover:bg-white/15 rounded px-2 py-1 border border-white/10"
                                >
                                  Apply role duration
                                </button>
                              )}
                            </div>
                          )}
                        </div>
                      </details>
                    )}
                  </div>
                  <div>
                    <label className="text-[10px] uppercase tracking-wider text-white/40">Speed</label>
                    <select
                      value={selectedClip.playbackRate || 1}
                      onChange={(e) => handlePlaybackRate(Number(e.target.value))}
                      className="mt-1 w-full bg-black/40 border border-white/10 rounded-lg px-3 py-2 text-white text-sm"
                    >
                      <option value="0.25">0.25x (Slo-mo)</option>
                      <option value="0.5">0.5x</option>
                      <option value="0.75">0.75x</option>
                      <option value="1">1.0x (Normal)</option>
                      <option value="1.5">1.5x</option>
                      <option value="2">2.0x</option>
                      <option value="2.5">2.5x</option>
                      <option value="3">3.0x</option>
                      <option value="4">4.0x</option>
                      <option value="5">5.0x (Max)</option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Extension Style */}
              <div className="space-y-3 pt-4 border-t border-white/5">
                <p className="text-sm font-semibold text-white">Extension Style</p>
                <div className="grid grid-cols-3 gap-2">
                  {[
                    { mode: 'slowmo', label: 'Slow Motion' },
                    { mode: 'freeze', label: 'Freeze Frame' },
                    { mode: 'loop', label: 'Loop' },
                  ].map(({ mode, label }) => (
                    <button
                      key={mode}
                      onClick={() => handleHoldStrategy(mode as 'freeze' | 'loop' | 'slowmo')}
                      className={`px-2 py-2 rounded-lg border text-xs font-medium transition ${selectedClip.holdFrameStrategy === mode ? 'border-insta-mid bg-insta-mid/10 text-white' : 'border-white/10 text-white/60 hover:bg-white/5'}`}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              {/* Captions */}
              <div className="space-y-4 pt-4 border-t border-white/5">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-semibold text-white">Captions</p>
                  <div className="flex items-center gap-3">
                    {activeCaptions.length > 0 && (
                      <button onClick={() => updateCaptions([])} className="text-xs text-white/50 hover:text-white transition">
                        Reset to Derived
                      </button>
                    )}
                    <button onClick={() => handleAddCaption('blank')} className="text-xs text-insta-mid hover:text-white transition">+ Add</button>
                  </div>
                </div>

                <div className="space-y-2">
                  {activeCaptions.map((cap) => (
                    <div key={cap.id} className="bg-white/5 border border-white/10 rounded-lg p-3 space-y-2">
                      <textarea
                        value={cap.text}
                        onChange={(e) => handleCaptionChange(cap.id, { text: e.target.value })}
                        className="w-full bg-black/30 border-none rounded text-sm text-white resize-none focus:ring-1 focus:ring-white/30"
                        rows={2}
                      />
                      <div className="flex justify-between items-center">
                        <select
                          value={cap.stylePreset || 'bold-pop'}
                          onChange={(e) => handleCaptionChange(cap.id, { stylePreset: e.target.value as any })}
                          className="bg-transparent text-xs text-white/60 border-none p-0 focus:ring-0"
                        >
                          <option value="bold-pop">Bold Pop</option>
                          <option value="minimal">Minimal</option>
                          <option value="cinematic">Cinematic</option>
                        </select>
                        <button onClick={() => handleDeleteCaption(cap.id)} className="text-xs text-red-400 hover:text-red-300">Remove</button>
                      </div>
                    </div>
                  ))}
                  {activeCaptions.length === 0 && (
                    <div className="text-center py-4 border border-dashed border-white/10 rounded-lg text-xs text-white/30">
                      <div>{segmentScript ? 'Using derived scene text from Script Studio.' : 'No captions added'}</div>
                      {segmentScript && (
                        <div className="mt-2 text-white/50 max-w-[240px] mx-auto leading-relaxed">
                          {segmentScript}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </>
          ) : (
            <div className="h-full flex flex-col items-center justify-center text-center text-white/40 space-y-4">
              <div className="text-4xl">👈</div>
              <p>Select a clip from the timeline<br />to edit its properties.</p>
            </div>
          )}
        </div>

        {/* Right: Preview Area */}
        <div className="flex-1 bg-[#05070F] flex items-center justify-center p-8 relative">
          {selectedClip ? (
            <div className="relative aspect-[9/16] h-full max-h-[600px] bg-black rounded-2xl overflow-hidden shadow-2xl border border-white/10">
              {selectedClip.type === 'video' ? (
                <video
                  ref={videoRef}
                  src={getMediaDisplayUrl(selectedClip)}
                  className="w-full h-full object-cover"
                  controls
                  key={selectedClip.id} // Force reload on change
                  onLoadedMetadata={() => {
                    if (videoRef.current) {
                      videoRef.current.playbackRate = selectedClip.playbackRate || 1;
                    }
                  }}
                  onPlay={() => {
                    if (videoRef.current) {
                      videoRef.current.playbackRate = selectedClip.playbackRate || 1;
                    }
                  }}
                />
              ) : (
                <img
                  src={getMediaDisplayUrl(selectedClip)}
                  className="w-full h-full object-cover"
                  alt="Preview"
                />
              )}
              {/* Caption Overlay Preview */}
              <div className="absolute inset-0 pointer-events-none">
                {activeCaptions.map(cap => (
                  <div
                    key={cap.id}
                    className="absolute w-full text-center px-4"
                    style={{ bottom: '20%' }}
                  >
                    <span className="bg-black/60 text-white px-2 py-1 rounded text-lg font-bold">
                      {cap.text}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div className="text-white/20 font-bold text-2xl tracking-widest uppercase">
              Preview
            </div>
          )}
        </div>
      </div>

      {/* Hidden file input for adding clips */}
      <input
        ref={fileInputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={handleFileUpload}
      />

      {/* Bottom: Timeline */}
      <Timeline
        media={media}
        selectedIndex={selectedIndex}
        onSelect={setSelectedIndex}
        onReorder={handleReorder}
        onTransitionChange={handleTransitionChange}
        onDelete={handleDeleteClip}
        onDuplicate={handleDuplicateClip}
        onAddClips={handleAddClips}
        onSplit={handleSplitClip}
        onCopy={handleCopyClip}
        onPaste={handlePasteClip}
        clipboard={clipboard}
        isPlaying={isPlaying}
        onPlayToggle={handlePlayToggle}
        currentTime={currentTime}
        onSeek={handleSeek}
      />
    </section>
  );
};

export default VideoExtensionStudio;
