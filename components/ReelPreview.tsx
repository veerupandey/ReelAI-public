import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import { UploadedMedia, ReelScript, VisualSettings, SubtitleSettings, AudioMixSettings, CaptionBlock, ExportPreset, DEFAULT_SUBTITLE_SETTINGS, DEFAULT_AUDIO_MIX_SETTINGS } from '../types';
import { getMediaDisplayUrl } from '../utils/sceneDrafts';
import { placeAudioSegmentsInTimeline, audioBufferToWavBlob } from '../utils/audioHelper';
import {
    KenBurnsDirection, resolveDirection, computeKenBurns,
    generateDepthMap, DepthMap,
    drawLayeredParallax, ParticleSystem, drawFilmGrain, drawLightLeak, drawVignette,
    SpringSystem, computeCameraShake, CameraShakeConfig, segmentSubject, SegmentationMask,
    drawMotionBlur, computeSubjectTracking, drawChromaticAberration,
    detectBeats, getBeatIntensity, applyPerspectiveTilt,
    detectBPM, snapBoundariesToBeats,
    getLUTFilter, ColorLUT, computeTextAnimation, TextAnimationPreset,
    drawZoomBlur, drawGlitchEffect,
    evaluateKeyframeTrack, KeyframeTrack as KFTrack,
} from '../utils/motionEngine';

interface ReelPreviewProps {
    media: UploadedMedia[];
    script: ReelScript | null;
    audioBuffer: AudioBuffer | null;
    isPlaying: boolean;
    videoSpeed: number;
    audioPlaybackRate?: number;
    visualSettings: VisualSettings;
    subtitleSettings?: SubtitleSettings;
    audioMixSettings?: AudioMixSettings;
    slideDurations?: number[];
    audioSegmentDurations?: number[];
    onPlayToggle: () => void;
    onRestart: () => void;
    bgMusicBuffer?: AudioBuffer | null;
    enableCaptions?: boolean;
    exportPresets?: ExportPreset[];
    autoExportPresetId?: string;
    exportTriggerKey?: number;
    onVideoSpeedChange?: (speed: number) => void;
    onSceneChange?: (index: number) => void;
}

interface ExportFormat {
    mime: string;
    label: string;
    ext: string;
    videoBitsPerSecond?: number;
    audioBitsPerSecond?: number;
    width?: number;
    height?: number;
}

const CANVAS_WIDTH = 1080;
const CANVAS_HEIGHT = 1920;
const DEFAULT_VIDEO_BITRATE = 12_000_000; // 12 Mbps for crisp 1080p
const DEFAULT_AUDIO_BITRATE = 192_000; // 192 kbps stereo
const HOOK_DISPLAY_DURATION = 2.2; // seconds to show the viral hook flash
const MIN_SLIDE_DURATION = 0.7;
const DEFAULT_MEDIA_DURATION = 3;

interface CanvasCaptureMediaStreamTrack extends MediaStreamTrack {
    requestFrame: () => void;
}

const deriveClipDuration = (clip: UploadedMedia): number => {
    const MAX_CLIP_DURATION = 30;
    // Priority 1: extendedDuration (manually set in Video Extension Studio)
    if (typeof clip.extendedDuration === 'number' && Number.isFinite(clip.extendedDuration)) {
        return Math.max(MIN_SLIDE_DURATION, Math.min(MAX_CLIP_DURATION, clip.extendedDuration));
    }

    // Priority 2: trimmed duration (endTime - startTime)
    const start = typeof clip.startTime === 'number' ? clip.startTime : 0;
    const end = typeof clip.endTime === 'number' ? clip.endTime : undefined;
    const trimmed = Number.isFinite(end) ? Math.max(0, (end as number) - start) : undefined;

    // Priority 3: clip.duration or default
    const fallback = Number.isFinite(clip.duration) ? (clip.duration as number) : DEFAULT_MEDIA_DURATION;
    const base = trimmed && trimmed > 0 ? trimmed : fallback;

    return Math.max(MIN_SLIDE_DURATION, Math.min(MAX_CLIP_DURATION, base || DEFAULT_MEDIA_DURATION));
};

const getSceneIndexForDisplayTime = (
    displayTime: number,
    timeline: number[],
    mediaLength: number,
    totalVisualDuration: number,
): number => {
    if (mediaLength <= 0 || timeline.length === 0) return 0;
    for (let i = 0; i < timeline.length; i++) {
        if (displayTime < timeline[i]) {
            return i;
        }
    }
    if (displayTime >= totalVisualDuration) {
        return Math.min(mediaLength - 1, timeline.length - 1);
    }
    return 0;
};

const getEffectiveFramingMode = (
    requestedMode: VisualSettings['framingMode'] | undefined,
    item: UploadedMedia,
    mediaWidth: number,
    mediaHeight: number,
    canvasWidth: number,
    canvasHeight: number,
): 'cover' | 'contain' => {
    const baseMode = requestedMode || 'cover';
    if (baseMode === 'contain') return 'contain';
    if (item.aiFramingMode === 'contain') return 'contain';
    if (item.aiFramingMode === 'cover') return 'cover';
    if (item.type !== 'image') return baseMode;
    if (!mediaWidth || !mediaHeight) return baseMode;

    // Text-heavy keyword detection — runs for all image origins now, not just brand/user uploads.
    const contentText = `${item.description || ''} ${item.imagePrompt || ''} ${item.aiPresentationReason || ''}`.toLowerCase();
    const isTextHeavy = /(benefit|benefits|claim|claims|headline|text|copy|card|graphic|infographic|comparison|before\s*after|ingredient|ingredients|badge|label|pricing|price|feature|features|treats acne|acne|results|callout|bullet|vitamin|nutrition|how to|step|recipe|list|tip|facts)/i.test(contentText);
    if (isTextHeavy) {
        return 'contain';
    }

    const mediaAspect = mediaWidth / mediaHeight;
    const canvasAspect = canvasWidth / canvasHeight;
    const aspectRatio = mediaAspect / canvasAspect;

    // Preserve the full frame for tall images so content near the top/bottom isn't clipped.
    if (aspectRatio < 1) {
        return 'contain';
    }

    // Wide/landscape images in a portrait canvas lose 40-68% of their width in cover mode.
    // Switch to contain so text-heavy graphics, product cards, and infographics stay readable.
    // Threshold 1.4 = image is 40%+ wider than the canvas aspect would naturally show.
    if (aspectRatio > 1.4) {
        return 'contain';
    }

    return baseMode;
};

const ReelPreview: React.FC<ReelPreviewProps> = ({
    media,
    script,
    audioBuffer,
    isPlaying,
    videoSpeed,
    audioPlaybackRate = 1.0,
    visualSettings,
    subtitleSettings = { ...DEFAULT_SUBTITLE_SETTINGS },
    audioMixSettings = { ...DEFAULT_AUDIO_MIX_SETTINGS },
    slideDurations,
    audioSegmentDurations,
    onPlayToggle,
    onRestart,
    bgMusicBuffer,
    enableCaptions = true,
    exportPresets,
    autoExportPresetId,
    exportTriggerKey,
    onVideoSpeedChange,
    onSceneChange,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const animationRef = useRef<number | null>(null);
    const [currentTime, setCurrentTime] = useState(0);
    const [duration, setDuration] = useState(0);
    const [isExporting, setIsExporting] = useState(false);
    const [exportProgress, setExportProgress] = useState(0);
    const [showExportModal, setShowExportModal] = useState(false);
    const [detectedFormats, setDetectedFormats] = useState<ExportFormat[]>([]);
    const [timeline, setTimeline] = useState<number[]>([]);
    const [voicePlaybackBuffer, setVoicePlaybackBuffer] = useState<AudioBuffer | null>(null);
    const timelineDuration = useMemo(() => (timeline.length ? timeline[timeline.length - 1] : 0), [timeline]);
    const [lastHandledTrigger, setLastHandledTrigger] = useState(0);
    const lastReportedSceneIndexRef = useRef(-1);

    const effectivePlaybackSpeed = useMemo(() => Math.max(0.1, videoSpeed || 1), [videoSpeed]);
    // Keep spoken audio style stable. Master video speed should not re-pitch / re-characterize the voice.
    // `audioPlaybackRate` is reserved for intentional timeline-fit compensation from the editor.
    // Timeline advances at the master speed so visuals/scenes/captions all speed up.
    // Audio now scales with the video speed to maintain sync in preview.
    // Exports always run at 1x so there's no sync drift in the final output.
    const effectiveTimelineRate = useMemo(() => {
        if (isExporting) return 1;
        return effectivePlaybackSpeed;
    }, [isExporting, effectivePlaybackSpeed]);

    // audioPlaybackRate is kept for API compatibility but no longer used for sync compensation.
    const effectiveAudioRate = 1.0;

    const contextStartRef = useRef<number>(0);
    const playbackOffsetRef = useRef<number>(0); // seconds into timeline
    const playbackSpeedRef = useRef<number>(1);
    const playbackRequestRef = useRef<number>(0);
    const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const musicSourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
    const audioContextRef = useRef<AudioContext | null>(null);
    const exportStartRef = useRef<number | null>(null); // performance.now() when export began
    const exportDurationRef = useRef<number>(0);
    const recorderRef = useRef<MediaRecorder | null>(null);
    const exportSilenceRef = useRef<AudioBufferSourceNode | null>(null);
    const exportActiveRef = useRef(false);
    const voiceGainRef = useRef<GainNode | null>(null);
    const musicGainRef = useRef<GainNode | null>(null);
    const voiceAudioElRef = useRef<HTMLAudioElement | null>(null);
    const voiceAudioUrlRef = useRef<string | null>(null);
    const voiceMediaSourceRef = useRef<MediaElementAudioSourceNode | null>(null);
    /** Mix bus for original clip soundtracks (preview + export). */
    const clipBusGainRef = useRef<GainNode | null>(null);
    const videoMediaSourceMapRef = useRef<Map<HTMLVideoElement, MediaElementAudioSourceNode>>(new Map());
    const videoClipGainMapRef = useRef<Map<HTMLVideoElement, GainNode>>(new Map());

    // Motion engine refs
    const depthMapsRef = useRef<Map<number, DepthMap | null>>(new Map());
    const segmentationRef = useRef<Map<number, SegmentationMask | null>>(new Map());
    const particleSystemRef = useRef<ParticleSystem | null>(null);
    const lastMotionTimeRef = useRef<number>(0);
    const springSystemRef = useRef<SpringSystem | null>(null);
    const beatsRef = useRef<number[]>([]);
    const bpmRef = useRef<number>(0);
    const prevPanRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

    const videoElementsRef = useRef<{ [key: number]: HTMLVideoElement }>({});
    const imageElementsRef = useRef<{ [key: number]: HTMLImageElement }>({});
    const lastFrameRef = useRef<ImageData | null>(null);

    // Initialize Audio Context
    useEffect(() => {
        if (!audioContextRef.current) {
            audioContextRef.current = new (window.AudioContext || (window as any).webkitAudioContext)();
        }

        if (typeof MediaRecorder === 'undefined') {
            setDetectedFormats([{ mime: '', label: 'Browser default', ext: 'webm' }]);
            return;
        }

        const detected: ExportFormat[] = [];
        const mp4MimeOptions = [
            'video/mp4; codecs="avc1.640028, mp4a.40.2"',
            'video/mp4; codecs="avc1.4D401F, mp4a.40.2"',
            'video/mp4'
        ];

        mp4MimeOptions.forEach((mime, idx) => {
            if (MediaRecorder.isTypeSupported(mime)) {
                detected.push({
                    mime,
                    label: idx === 0 ? 'MP4 (1080p • Instagram Ready)' : idx === 1 ? 'MP4 (High • fallback codec)' : 'MP4 (Browser fallback)',
                    ext: 'mp4',
                    videoBitsPerSecond: idx === 0 ? 12_000_000 : idx === 1 ? 10_000_000 : undefined,
                    audioBitsPerSecond: 192_000,
                });
            }
        });

        const webmMimeOptions = ['video/webm; codecs="vp9,opus"', 'video/webm; codecs="vp8,opus"', 'video/webm'];
        webmMimeOptions.some((mime, idx) => {
            if (MediaRecorder.isTypeSupported(mime)) {
                detected.push({
                    mime,
                    label: idx === 0 ? 'WebM (Hi-Fi • editing)' : idx === 1 ? 'WebM (Standard)' : 'WebM (Fallback)',
                    ext: 'webm',
                    videoBitsPerSecond: idx === 0 ? 10_000_000 : undefined,
                    audioBitsPerSecond: 192_000,
                });
                return true;
            }
            return false;
        });

        if (detected.length === 0) {
            detected.push({ mime: '', label: 'Browser default', ext: 'webm' });
        }

        setDetectedFormats(detected);

    }, []);

    const presetToFormat = useCallback((preset: ExportPreset): ExportFormat | null => {
        if (typeof MediaRecorder === 'undefined') return null;
        let candidateMimes: string[] = [];
        if (preset.format === 'mp4' || preset.format === 'mov') {
            candidateMimes = ['video/mp4; codecs="avc1.640028, mp4a.40.2"', 'video/mp4; codecs="avc1.4D401F, mp4a.40.2"', 'video/mp4'];
        } else if (preset.format === 'webm') {
            candidateMimes = ['video/webm; codecs="vp9,opus"', 'video/webm; codecs="vp8,opus"', 'video/webm'];
        }

        if (candidateMimes.length === 0) return null;
        const supportedMime = candidateMimes.find(m => MediaRecorder.isTypeSupported(m));
        if (!supportedMime) return null;

        return {
            mime: supportedMime,
            label: `${preset.label} • ${preset.description}`,
            ext: preset.format === 'mov' ? 'mp4' : preset.format,
            videoBitsPerSecond: preset.videoBitrate,
            audioBitsPerSecond: preset.audioBitrate,
            width: preset.width,
            height: preset.height,
        };
    }, []);

    const formatsToShow = useMemo(() => {
        if (exportPresets && exportPresets.length) {
            const mapped = exportPresets
                .map(presetToFormat)
                .filter((f): f is ExportFormat => Boolean(f));
            if (mapped.length) return mapped;
        }
        return detectedFormats;
    }, [exportPresets, detectedFormats, presetToFormat]);

    const effectiveTimelineDurations = useMemo(() => {
        const visualDurations = media.map(deriveClipDuration);
        return media.map((_, idx) => {
            const visual = visualDurations[idx];
            if (!slideDurations || slideDurations.length === 0) return visual;
            const provided = slideDurations[idx];
            if (typeof provided !== 'number' || !Number.isFinite(provided)) return visual;
            return Math.max(MIN_SLIDE_DURATION, provided);
        });
    }, [audioBuffer, media, slideDurations]);
    const invalidVoiceSceneIndexes = useMemo(() => {
        if (!audioSegmentDurations || audioSegmentDurations.length !== effectiveTimelineDurations.length) {
            return [];
        }
        return audioSegmentDurations.flatMap((voiceSec, index) =>
            Number(voiceSec) > effectiveTimelineDurations[index] + 0.01 ? [index] : [],
        );
    }, [audioSegmentDurations, effectiveTimelineDurations]);
    const voiceTimelineInvalid = invalidVoiceSceneIndexes.length > 0;

    // Update Duration & Timeline
    useEffect(() => {
        if (!media || media.length === 0) {
            setTimeline([]);
            setDuration(0);
            return;
        }

        let acc = 0;
        const cumulative: number[] = effectiveTimelineDurations.map((d) => {
            acc += d;
            return acc;
        });

        setTimeline(cumulative);

    // Drive total duration from visual timeline; playback speed will affect runtime via render loop, not by shrinking the timeline seconds.
        setDuration(acc);
    }, [effectiveTimelineDurations, media]);

    // Snap scene boundaries to beat drops when beat zoom is enabled
    // This aligns transitions to the actual beat for maximum impact
    useEffect(() => {
        if (beatsRef.current.length === 0 || timeline.length === 0) return;
        const hasBeatZoom = visualSettings.enableBeatZoom ||
            Object.values(visualSettings.perSceneOverrides || {}).some((s: any) => s.enableBeatZoom);
        if (!hasBeatZoom) return;

        const snapped = snapBoundariesToBeats(timeline, beatsRef.current, 0.3);
        // Only update if something actually changed
        if (snapped.some((t, i) => Math.abs(t - timeline[i]) > 0.01)) {
            setTimeline(snapped);
        }
    }, [timeline, visualSettings.enableBeatZoom, visualSettings.perSceneOverrides]);

    // Keep generated voice samples untouched. Scene slack is represented by silence,
    // so narration remains clean while each line still starts at its scene boundary.
    useEffect(() => {
        if (!audioBuffer) {
            setVoicePlaybackBuffer(null);
            return;
        }
        if (
            !audioSegmentDurations
            || audioSegmentDurations.length !== effectiveTimelineDurations.length
        ) {
            setVoicePlaybackBuffer(audioBuffer);
            return;
        }
        if (voiceTimelineInvalid) {
            setVoicePlaybackBuffer(null);
            return;
        }

        const ctx = audioContextRef.current;
        if (!ctx) {
            setVoicePlaybackBuffer(audioBuffer);
            return;
        }

        try {
            setVoicePlaybackBuffer(placeAudioSegmentsInTimeline(
                audioBuffer,
                ctx,
                audioSegmentDurations,
                effectiveTimelineDurations,
            ));
        } catch (e) {
            console.warn('[ReelPreview] voice timeline placement failed, using original audio:', e);
            setVoicePlaybackBuffer(audioBuffer);
        }
    }, [audioBuffer, effectiveTimelineDurations, audioSegmentDurations, voiceTimelineInvalid]);

    // Detect beats + BPM from audio buffer for audio-reactive effects
    useEffect(() => {
        if (audioBuffer) {
            try {
                beatsRef.current = detectBeats(audioBuffer);
                bpmRef.current = detectBPM(audioBuffer);
            } catch (e) {
                beatsRef.current = [];
                bpmRef.current = 0;
            }
        } else {
            beatsRef.current = [];
            bpmRef.current = 0;
        }
    }, [audioBuffer]);

    // Use the same clean, scene-aligned buffer for preview and export.
    useEffect(() => {
        const buffer = voicePlaybackBuffer;
        if (!buffer) {
            if (voiceAudioUrlRef.current) {
                URL.revokeObjectURL(voiceAudioUrlRef.current);
                voiceAudioUrlRef.current = null;
            }
            return;
        }

        const blob = audioBufferToWavBlob(buffer);
        if (voiceAudioUrlRef.current) URL.revokeObjectURL(voiceAudioUrlRef.current);
        voiceAudioUrlRef.current = URL.createObjectURL(blob);

        if (!voiceAudioElRef.current) {
            const el = new Audio();
            el.preload = 'auto';
            (el as any).preservesPitch = true;
            (el as any).preservePitch = true; // Firefox
            voiceAudioElRef.current = el;
        }
        voiceAudioElRef.current.src = voiceAudioUrlRef.current;
    }, [voicePlaybackBuffer]);

    // Preload Media
    useEffect(() => {
        // Include trim/playback metadata so edits refresh cached elements
        const signature = media.map(m => [
            m.previewUrl || m.base64?.slice(0, 32) || '',
            m.startTime ?? 0,
            m.endTime ?? '',
            m.playbackRate ?? 1,
            m.holdFrameStrategy ?? '',
            m.extensionAnchor ?? '',
            m.extensionLoopDuration ?? '',
            m.duration ?? ''
        ].join(':')).join('|');
        if ((videoElementsRef.current as any)._lastSignature === signature) return;
        (videoElementsRef.current as any)._lastSignature = signature;

        // Cleanup primary videos
        Object.values(videoElementsRef.current).forEach((video) => {
            if (video instanceof HTMLVideoElement) {
                video.pause();
                video.src = "";
                video.remove();
            }
        });
        videoElementsRef.current = { _lastSignature: signature } as any;
        imageElementsRef.current = {};
        // MediaElementSources are tied to destroyed elements — rebuild on next play.
        videoMediaSourceMapRef.current.clear();
        videoClipGainMapRef.current.clear();
        clipBusGainRef.current = null;

        media.forEach((item, index) => {
            if (item.type === 'video') {
                const vid = document.createElement('video');
                vid.crossOrigin = "anonymous";
                vid.src = getMediaDisplayUrl(item);
                // Start muted for autoplay-safe preload; unmuted via clip mix when playing.
                vid.muted = true;
                vid.playsInline = true;
                vid.preload = 'auto';
                vid.defaultPlaybackRate = videoSpeed;
                vid.playbackRate = videoSpeed;
                if (item.startTime) vid.currentTime = item.startTime;
                videoElementsRef.current[index] = vid;
            } else {
                const img = new Image();
                img.crossOrigin = "anonymous";
                img.src = getMediaDisplayUrl(item);
                imageElementsRef.current[index] = img;
            }
        });
    }, [media]); // We handle videoSpeed separately

    // Generate depth maps + segmentation for parallax and initialize particle/spring systems
    useEffect(() => {
        depthMapsRef.current.clear();
        segmentationRef.current.clear();
        media.forEach((item, index) => {
            if (item.type === 'image') {
                const img = imageElementsRef.current[index];
                const processImage = (el: HTMLImageElement) => {
                    try {
                        const depth = generateDepthMap(el);
                        depthMapsRef.current.set(index, depth);
                        const seg = segmentSubject(depth);
                        segmentationRef.current.set(index, seg);
                    } catch (e) {
                        depthMapsRef.current.set(index, null);
                        segmentationRef.current.set(index, null);
                    }
                };
                if (img && img.complete && img.naturalWidth > 0) {
                    processImage(img);
                } else if (img) {
                    img.onload = () => processImage(img);
                }
            }
        });
        if (!particleSystemRef.current) {
            particleSystemRef.current = new ParticleSystem(1080, 1920);
        }
        if (!springSystemRef.current) {
            springSystemRef.current = new SpringSystem(80, 14, 1);
        }
    }, [media]);

    // Update Playback Rate without recreating elements
    useEffect(() => {
        Object.values(videoElementsRef.current).forEach((video) => {
            if (video instanceof HTMLVideoElement) {
                video.defaultPlaybackRate = videoSpeed;
                video.playbackRate = videoSpeed;
            }
        });
    }, [videoSpeed]);

    const ensureClipBus = useCallback((): GainNode | null => {
        const ac = audioContextRef.current;
        if (!ac) return null;
        if (!clipBusGainRef.current) {
            const bus = ac.createGain();
            bus.gain.value = 1;
            bus.connect(ac.destination);
            clipBusGainRef.current = bus;
        }
        return clipBusGainRef.current;
    }, []);

    const ensureVideoClipInMix = useCallback((video: HTMLVideoElement): GainNode | null => {
        const ac = audioContextRef.current;
        const bus = ensureClipBus();
        if (!ac || !bus) return null;

        let gain = videoClipGainMapRef.current.get(video);
        if (gain) return gain;

        try {
            const source = ac.createMediaElementSource(video);
            gain = ac.createGain();
            gain.gain.value = 0;
            source.connect(gain);
            gain.connect(bus);
            videoMediaSourceMapRef.current.set(video, source);
            videoClipGainMapRef.current.set(video, gain);
            // Element output is redirected into the graph; keep unmuted so the node receives audio.
            video.muted = false;
            video.volume = 1;
            return gain;
        } catch (e) {
            console.warn('[ReelPreview] Failed to route clip audio into mix:', e);
            return null;
        }
    }, [ensureClipBus]);

    const syncClipAudioLevels = useCallback((activeIndex: number, audible: boolean) => {
        const clipVolume = Math.max(0, Math.min(1, audioMixSettings.clipVolume ?? 0));
        const target = audible && clipVolume > 0 ? clipVolume : 0;

        Object.entries(videoElementsRef.current).forEach(([key, video]) => {
            if (!(video instanceof HTMLVideoElement)) return;
            const index = Number(key);
            if (!Number.isFinite(index)) return;

            if (target > 0) {
                const gain = ensureVideoClipInMix(video);
                if (gain) {
                    gain.gain.value = index === activeIndex ? target : 0;
                } else {
                    // Fallback: direct element volume if Web Audio routing fails
                    const isActiveClip = index === activeIndex;
                    video.muted = !isActiveClip;
                    video.volume = isActiveClip ? target : 0;
                }
            } else {
                const gain = videoClipGainMapRef.current.get(video);
                if (gain) gain.gain.value = 0;
                // Keep muted when clip mix is off (autoplay-safe idle state)
                if (!videoMediaSourceMapRef.current.has(video)) {
                    video.muted = true;
                    video.volume = 0;
                }
            }
        });
    }, [audioMixSettings.clipVolume, ensureVideoClipInMix]);

    // REAL-TIME VOLUME UPDATES
    useEffect(() => {
        if (voiceAudioElRef.current) {
            voiceAudioElRef.current.volume = audioMixSettings.voiceVolume;
        }
        if (musicGainRef.current && audioContextRef.current) {
            musicGainRef.current.gain.linearRampToValueAtTime(
                audioMixSettings.musicVolume,
                audioContextRef.current.currentTime,
            );
        }
    }, [audioMixSettings.voiceVolume, audioMixSettings.musicVolume]);

    const drawFrame = useCallback((
        ctx: CanvasRenderingContext2D,
        displayTime: number,
        isActive: boolean
    ) => {
        const { width, height } = ctx.canvas;
        const framingMode = visualSettings.framingMode || 'cover';

        const totalVisualDuration = timelineDuration || duration;
        const currentIndex = getSceneIndexForDisplayTime(displayTime, timeline, media.length, totalVisualDuration);

        // Sync clip audio even when the timeline is not ready yet / draw later throws.
        syncClipAudioLevels(currentIndex, isActive);

        if (timeline.length === 0) return;

        // Clear canvas
        ctx.fillStyle = '#000';
        ctx.fillRect(0, 0, width, height);

        const nextIndex = Math.min(currentIndex + 1, media.length - 1);
        const slideEndTime = timeline[currentIndex];
        const slideStartTime = currentIndex === 0 ? 0 : timeline[currentIndex - 1];
        const slideDuration = slideEndTime - slideStartTime;
        const timeInSlide = displayTime - slideStartTime;

        // Transition Logic — use per-scene override if available, else per-clip, else global
        const sceneTransitionOverride = visualSettings.perSceneOverrides?.[currentIndex]?.transitionEffect;
        const currentTransition = sceneTransitionOverride
            ?? media[nextIndex]?.transitionEffect
            ?? visualSettings.transitionEffect
            ?? 'fade';
        const TRANSITION_DURATION = Math.min(0.8, slideDuration / 2);
        const isTransitioning =
            currentTransition !== 'none' &&
            currentIndex < media.length - 1 &&
            timeInSlide > (slideDuration - TRANSITION_DURATION);

        let progress = 0;
        if (isTransitioning) {
            progress = (timeInSlide - (slideDuration - TRANSITION_DURATION)) / TRANSITION_DURATION;
        }

        const drawLayer = (index: number, opacity: number, xOffset: number, scale: number) => {
            if (index < 0 || index >= media.length) return;
            const item = media[index];

            // Resolve per-scene overrides (AI Auto-Direct per-scene settings)
            const sceneOverride = visualSettings.perSceneOverrides?.[index] || {};
            const effectiveColorLUT = sceneOverride.colorLUT ?? visualSettings.colorLUT ?? 'none';
            const effectiveMotionBlur = sceneOverride.motionBlur ?? visualSettings.motionBlur ?? 0;
            const effectiveChromaticAberration = sceneOverride.chromaticAberration ?? visualSettings.chromaticAberration ?? 0;
            const effectivePerspectiveTilt = sceneOverride.perspectiveTilt ?? visualSettings.perspectiveTilt ?? 0;
            const effectiveSubjectTracking = sceneOverride.enableSubjectTracking ?? visualSettings.enableSubjectTracking ?? false;
            const effectiveBeatZoom = sceneOverride.enableBeatZoom ?? visualSettings.enableBeatZoom ?? false;
            const effectiveMotionDir = sceneOverride.motionDirection ?? visualSettings.motionDirection ?? 'random';
            const effectiveMotionIntensity = sceneOverride.motionIntensity ?? visualSettings.motionIntensity ?? 0.5;

            ctx.save();
            ctx.globalAlpha = opacity;

            // Visual Filters + Color LUT
            let filterString = `brightness(${visualSettings.brightness}) contrast(${visualSettings.contrast}) saturate(${visualSettings.saturation})`;

            if (visualSettings.filterPreset === 'noir') filterString += ' grayscale(100%) contrast(1.2)';
            if (visualSettings.filterPreset === 'warm') filterString += ' sepia(0.3) saturate(1.2)';
            if (visualSettings.filterPreset === 'cool') filterString += ' hue-rotate(180deg) sepia(0.2)';
            if (visualSettings.filterPreset === 'cinematic') filterString += ' contrast(1.1) saturate(0.9) sepia(0.1)';
            if (visualSettings.filterPreset === 'vibrant') filterString += ' saturate(1.5) contrast(1.1)';

            // Color grading LUT (per-scene override)
            if (effectiveColorLUT !== 'none') {
                filterString += ' ' + getLUTFilter(effectiveColorLUT as ColorLUT);
            }

            try { ctx.filter = filterString; } catch (e) { ctx.filter = 'none'; }

            // ── Motion Engine: Ken Burns + Spring Physics + Camera Shake ────
            const motionDir = effectiveMotionDir;
            const motionIntensity = effectiveMotionIntensity;
            const enableParallax = visualSettings.enableParallax !== false;
            const allowMotion = visualSettings.enableZoom || motionDir !== 'random' || motionIntensity > 0;

            let dynamicScale = 1;
            let panX = 0;
            let panY = 0;
            let shakeRot = 0;

            if (allowMotion) {
                let localTime = timeInSlide;
                let localDur = slideDuration;
                if (index === nextIndex && isTransitioning) {
                    localTime = 0;
                } else if (index < timeline.length) {
                    localDur = timeline[index] - (index === 0 ? 0 : timeline[index - 1]);
                }
                const t = Math.min(1, localTime / Math.max(0.1, localDur));

                // Keyframe override: if user-set keyframes exist for this scene, use them
                const sceneKfs = visualSettings.sceneKeyframes?.[index];
                if (sceneKfs && sceneKfs.some(trk => trk.keyframes.length >= 2)) {
                    const findTrack = (prop: KFTrack['property']): KFTrack | undefined =>
                        sceneKfs.find(trk => trk.property === prop && trk.keyframes.length >= 2);

                    const scaleTrack = findTrack('scale');
                    const panXTrack = findTrack('panX');
                    const panYTrack = findTrack('panY');
                    const rotTrack = findTrack('rotation');
                    const opacityTrack = findTrack('opacity');

                    if (scaleTrack) dynamicScale = evaluateKeyframeTrack(scaleTrack, t);
                    if (panXTrack) panX = evaluateKeyframeTrack(panXTrack, t);
                    if (panYTrack) panY = evaluateKeyframeTrack(panYTrack, t);
                    if (rotTrack) shakeRot = evaluateKeyframeTrack(rotTrack, t) * Math.PI / 180;
                    if (opacityTrack) ctx.globalAlpha = opacity * evaluateKeyframeTrack(opacityTrack, t);
                } else {
                    const seed = (index * 0.137 + 0.3) % 1;
                    const resolvedDir = resolveDirection(motionDir as KenBurnsDirection, seed);
                    const kb = computeKenBurns(resolvedDir, t, motionIntensity, width, height);

                    // Spring physics: camera follows Ken Burns target with damped spring
                    if (springSystemRef.current) {
                        springSystemRef.current.setTarget(kb.panX, kb.panY, kb.scale);
                        const spring = springSystemRef.current.update(1 / 30);
                        dynamicScale = spring.scale;
                        panX = spring.x;
                        panY = spring.y;
                    } else {
                        dynamicScale = kb.scale;
                        panX = kb.panX;
                        panY = kb.panY;
                    }
                }

                // Perlin noise camera shake (handheld simulation) — applies to both paths
                const shakeConfig: CameraShakeConfig = {
                    enabled: motionIntensity > 0.3,
                    intensity: motionIntensity * 3, // 0-3px subtle shake
                    frequency: 2,
                };
                const shake = computeCameraShake(performance.now(), shakeConfig);
                panX += shake.x;
                panY += shake.y;
                shakeRot = shake.rotation;

                // Audio-reactive beat zoom (per-scene override, BPM-aware)
                if (effectiveBeatZoom && beatsRef.current.length > 0) {
                    const beatIntensity = getBeatIntensity(beatsRef.current, displayTime);
                    // Scale pulse by BPM — faster songs get subtler pulses, slower songs get dramatic
                    const bpmScale = bpmRef.current > 0 ? Math.min(1, 120 / bpmRef.current) : 1;
                    dynamicScale += beatIntensity * 0.08 * bpmScale;
                }

                // Subject tracking: keep subject centered during zoom (per-scene override)
                if (effectiveSubjectTracking) {
                    const seg = segmentationRef.current.get(index);
                    const track = computeSubjectTracking(seg ?? null, width, height, dynamicScale);
                    panX += track.offsetX;
                    panY += track.offsetY;
                }

                // Compute velocity for motion blur
                const velX = panX - prevPanRef.current.x;
                const velY = panY - prevPanRef.current.y;
                prevPanRef.current = { x: panX, y: panY };

                // 3D perspective tilt (per-scene override)
                const tiltAmount = effectivePerspectiveTilt;
                if (tiltAmount > 0) {
                    const tiltX = Math.sin(displayTime * 0.5) * tiltAmount * 0.15;
                    const tiltY = Math.cos(displayTime * 0.3) * tiltAmount * 0.15;
                    applyPerspectiveTilt(ctx, width, height, tiltX, tiltY);
                }

                // Store velocity for motion blur usage later
                (ctx as any).__motionVelX = velX;
                (ctx as any).__motionVelY = velY;
            }

            ctx.translate(width / 2 + xOffset + panX, height / 2 + panY);
            if (shakeRot) ctx.rotate(shakeRot);
            ctx.scale(scale * dynamicScale, scale * dynamicScale);
            ctx.translate(-width / 2, -height / 2);

            if (item.type === 'video') {
                const video = videoElementsRef.current[index];
                if (video) {
                    const start = item.startTime || 0;
                    const end = item.endTime || video.duration;
                    const holdStrategy = item.holdFrameStrategy || 'slowmo'; // default to slowmo for smoothest result
                    const clipSourceDuration = Math.max(0.05, end - start);
                    const userPlaybackRate = item.playbackRate || 1;
                    const anchorOffset = typeof item.extensionAnchor === 'number' ? Math.min(Math.max(0, item.extensionAnchor), clipSourceDuration) : clipSourceDuration;
                    const freezeTime = Math.min(Math.max(start, start + anchorOffset), end - 0.0001);

                    // Calculate how much we need to slow down to fill the slide duration
                    // slideDuration = how long this clip should play on screen
                    // clipSourceDuration = actual video content length
                    const slowmoRate = Math.max(0.1, clipSourceDuration / slideDuration);

                    // Draw helper
                    const drawVideoFrame = () => {
                        if (video.readyState < 2) return false;
                        const effectiveFramingMode = getEffectiveFramingMode(framingMode, item, video.videoWidth, video.videoHeight, width, height);
                        const baseScale = effectiveFramingMode === 'contain'
                            ? Math.min(width / video.videoWidth, height / video.videoHeight)
                            : Math.max(width / video.videoWidth, height / video.videoHeight);
                        const scaleFactor = baseScale || 1;
                        const vw = video.videoWidth * scaleFactor;
                        const vh = video.videoHeight * scaleFactor;
                        const focusY = item.aiFramingFocusY ?? visualSettings.framingFocusY ?? 0.5;
                        const topAlign = effectiveFramingMode === 'cover'
                            ? (height - vh) * focusY
                            : (height - vh) / 2;
                        const leftAlign = (width - vw) / 2;

                        // Blurred backdrop for contain mode — parity with image contain rendering
                        if (effectiveFramingMode === 'contain') {
                            const bgScale = Math.max(width / video.videoWidth, height / video.videoHeight);
                            const bgW = video.videoWidth * bgScale;
                            const bgH = video.videoHeight * bgScale;
                            const bgLeft = (width - bgW) / 2;
                            const bgTop = (height - bgH) / 2;
                            ctx.save();
                            ctx.filter = 'blur(28px) brightness(0.35) saturate(1.1)';
                            ctx.drawImage(video, bgLeft, bgTop, bgW, bgH);
                            ctx.restore();
                            // Subtle dark vignette so background doesn't compete with content
                            ctx.save();
                            ctx.filter = 'none';
                            const vign = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.75);
                            vign.addColorStop(0, 'rgba(0,0,0,0)');
                            vign.addColorStop(1, 'rgba(0,0,0,0.45)');
                            ctx.fillStyle = vign;
                            ctx.fillRect(0, 0, width, height);
                            ctx.restore();
                        }

                        ctx.drawImage(video, leftAlign, topAlign, vw, vh);
                        return true;
                    };

                    if (isActive) {
                        const safeSetPlaybackRate = (rate: number) => {
                            if (!Number.isFinite(rate)) return;
                            video.playbackRate = Math.max(0.1, Math.min(5, rate));
                        };
                        if (holdStrategy === 'slowmo') {
                            // SLOW MOTION: Play video at reduced speed to exactly fill the slide duration
                            // This is the smoothest option - no seeking, no looping, just slower playback
                            const effectiveRate = slowmoRate * userPlaybackRate * videoSpeed;
                            safeSetPlaybackRate(effectiveRate);

                            if (video instanceof HTMLVideoElement && video.paused) video.play().catch(() => { });
                            if (video instanceof HTMLVideoElement && video.currentTime < start) video.currentTime = start;
                            // Let it play naturally - it will slow down to fill the time
                            if (Number.isFinite(end) && video.currentTime >= end - 0.01) {
                                // If we somehow reach the end, just hold the last frame
                                if (video instanceof HTMLVideoElement) {
                                    video.pause();
                                    if (Number.isFinite(end)) video.currentTime = Math.max(start, end - 0.01);
                                }
                            }
                        } else if (holdStrategy === 'freeze') {
                            // FREEZE: Play normally until anchor point, then freeze
                            const normalDuration = clipSourceDuration / userPlaybackRate;
                            if (timeInSlide < normalDuration) {
                                if (video instanceof HTMLVideoElement) {
                                    safeSetPlaybackRate(userPlaybackRate * videoSpeed);
                                    if (video.paused) video.play().catch(() => { });
                                    if (video.currentTime < start) video.currentTime = start;
                                }
                            } else {
                                // Freeze at anchor point
                                if (video instanceof HTMLVideoElement) {
                                    if (!video.paused) video.pause();
                                    if (Number.isFinite(freezeTime) && Math.abs(video.currentTime - freezeTime) > 0.02) {
                                        video.currentTime = freezeTime;
                                    }
                                }
                            }
                        } else {
                            // LOOP: Play normally, loop back when reaching end (may flash)
                            if (video instanceof HTMLVideoElement) {
                                safeSetPlaybackRate(userPlaybackRate * videoSpeed);
                                if (video.paused) video.play().catch(() => { });
                                if (!Number.isFinite(end) || video.currentTime >= end - 0.02 || video.currentTime < start) {
                                    video.currentTime = start;
                                }
                            }
                        }
                    } else {
                        if (video instanceof HTMLVideoElement) video.pause();
                    }

                    // Draw the video
                    if (!drawVideoFrame() && (item.thumbnailUrl || item.base64)) {
                        const img = new Image(); img.src = getMediaDisplayUrl(item);
                        if (img.complete) ctx.drawImage(img, 0, 0, width, height);
                    }
                }
            } else {
                const img = imageElementsRef.current[index];
                if (img && img.complete) {
                    const effectiveFramingMode = getEffectiveFramingMode(framingMode, item, img.width, img.height, width, height);
                    const baseScale = effectiveFramingMode === 'contain'
                        ? Math.min(width / img.width, height / img.height)
                        : Math.max(width / img.width, height / img.height);
                    const scaleFactor = baseScale || 1;
                    const iw = img.width * scaleFactor;
                    const ih = img.height * scaleFactor;
                    const focusY = item.aiFramingFocusY ?? visualSettings.framingFocusY ?? 0.5;
                    const topAlign = effectiveFramingMode === 'cover'
                        ? (height - ih) * focusY
                        : (height - ih) / 2;
                    const leftAlign = (width - iw) / 2;

                    if (effectiveFramingMode === 'contain') {
                        const bgScale = Math.max(width / img.width, height / img.height);
                        const bgWidth = img.width * bgScale;
                        const bgHeight = img.height * bgScale;
                        const bgLeft = (width - bgWidth) / 2;
                        const bgTop = (height - bgHeight) / 2;

                        ctx.save();
                        ctx.filter = 'blur(28px) brightness(0.35) saturate(1.1)';
                        ctx.drawImage(img, bgLeft, bgTop, bgWidth, bgHeight);
                        ctx.restore();
                        // Subtle dark vignette so background doesn't compete with content
                        ctx.save();
                        ctx.filter = 'none';
                        const vign = ctx.createRadialGradient(width / 2, height / 2, height * 0.2, width / 2, height / 2, height * 0.75);
                        vign.addColorStop(0, 'rgba(0,0,0,0)');
                        vign.addColorStop(1, 'rgba(0,0,0,0.45)');
                        ctx.fillStyle = vign;
                        ctx.fillRect(0, 0, width, height);
                        ctx.restore();
                    }

                    // Motion engine: layered parallax with per-pixel displacement + segmentation
                    const depth = depthMapsRef.current.get(index);
                    const seg = segmentationRef.current.get(index);
                    const motionBlurAmount = effectiveMotionBlur;
                    const velX = (ctx as any).__motionVelX || 0;
                    const velY = (ctx as any).__motionVelY || 0;

                    const drawImageLayer = () => {
                        if (enableParallax && depth && item.type === 'image') {
                            const cameraX = panX / width;
                            const cameraY = panY / height;
                            drawLayeredParallax(ctx, img, depth, seg ?? null, leftAlign, topAlign, iw, ih, cameraX, cameraY, 25);
                        } else {
                            ctx.drawImage(img, leftAlign, topAlign, iw, ih);
                        }
                    };

                    if (motionBlurAmount > 0 && (Math.abs(velX) > 0.5 || Math.abs(velY) > 0.5)) {
                        drawMotionBlur(ctx, drawImageLayer, velX, velY, motionBlurAmount);
                    } else {
                        drawImageLayer();
                    }

                    // Chromatic aberration post-effect (per-scene override)
                    const caAmount = effectiveChromaticAberration;
                    if (caAmount > 0 && canvasRef.current) {
                        ctx.save();
                        ctx.globalCompositeOperation = 'screen';
                        ctx.globalAlpha = caAmount * 0.5;
                        const split = caAmount * 8;
                        ctx.filter = 'hue-rotate(0deg) saturate(3)';
                        ctx.drawImage(canvasRef.current, split, 0, width, height, leftAlign, topAlign, iw, ih);
                        ctx.filter = 'hue-rotate(120deg) saturate(3)';
                        ctx.drawImage(canvasRef.current, -split, 0, width, height, leftAlign, topAlign, iw, ih);
                        ctx.restore();
                    }
                }
            }
            ctx.restore();
        };

        if (!isTransitioning) {
            drawLayer(currentIndex, 1, 0, 1);
        } else {
            if (currentTransition === 'fade') {
                drawLayer(currentIndex, 1, 0, 1);
                drawLayer(nextIndex, progress, 0, 1);
            } else if (currentTransition === 'slide') {
                drawLayer(currentIndex, 1, -progress * width, 1);
                drawLayer(nextIndex, 1, (1 - progress) * width, 1);
            } else if (currentTransition === 'zoom') {
                drawLayer(currentIndex, 1 - progress, 0, 1 + progress * 0.5);
                drawLayer(nextIndex, progress, 0, 1);
            } else if (currentTransition === 'zoom-blur') {
                // Zoom blur: outgoing scene zooms with blur, incoming fades in
                drawZoomBlur(ctx, () => drawLayer(currentIndex, 1 - progress, 0, 1 + progress * 0.8), width, height, progress);
                drawLayer(nextIndex, progress, 0, 1);
            } else if (currentTransition === 'glitch') {
                // Glitch: chromatic split + slice displacement during transition
                drawLayer(currentIndex, 1 - progress * 0.5, 0, 1);
                if (progress > 0.3) {
                    drawLayer(nextIndex, progress, 0, 1);
                }
                // Glitch overlay on top
                ctx.save();
                ctx.globalAlpha = progress * 0.6;
                if (canvasRef.current) drawGlitchEffect(ctx, canvasRef.current, width, height, progress, performance.now());
                ctx.restore();
            } else if (currentTransition === 'chromatic') {
                // Chromatic aberration transition: RGB split peaks at mid-transition
                const splitAmount = Math.sin(progress * Math.PI) * 12;
                drawLayer(currentIndex, 1 - progress, 0, 1);
                drawLayer(nextIndex, progress, 0, 1);
                // RGB split overlay
                ctx.save();
                ctx.globalCompositeOperation = 'screen';
                ctx.globalAlpha = Math.sin(progress * Math.PI) * 0.4;
                if (canvasRef.current) {
                    ctx.filter = 'hue-rotate(0deg) saturate(3)';
                    ctx.drawImage(canvasRef.current, splitAmount, 0, width, height);
                    ctx.filter = 'hue-rotate(120deg) saturate(3)';
                    ctx.drawImage(canvasRef.current, -splitAmount, 0, width, height);
                }
                ctx.restore();
            } else {
                drawLayer(currentIndex, 1, 0, 1);
            }
        }

        // ── Motion Engine: Cinematic Overlays ─────────────────────────
        ctx.filter = 'none';
        const now = performance.now();
        const dt = now - lastMotionTimeRef.current;
        lastMotionTimeRef.current = now;

        // Film grain
        if (visualSettings.grain && visualSettings.grain > 0) {
            drawFilmGrain(ctx, width, height, visualSettings.grain, now);
        }

        // Light leaks
        if (visualSettings.enableLightLeaks !== false) {
            drawLightLeak(ctx, width, height, now, 0.12);
        }

        // Particles (dust motes + light orbs)
        if (visualSettings.enableParticles !== false && particleSystemRef.current) {
            particleSystemRef.current.update(dt, now);
            particleSystemRef.current.draw(ctx);
        }

        // Vignette
        if (visualSettings.vignette && visualSettings.vignette > 0) {
            drawVignette(ctx, width, height, visualSettings.vignette);
        }

        // Show viral hook only on the opening seconds of the first scene
        const showHookOverlay = Boolean(enableCaptions && script?.hook && currentIndex === 0 && displayTime < HOOK_DISPLAY_DURATION);

        const clipCaptions = enableCaptions ? (media[currentIndex]?.captions || []) : [];
        const activeClipCaptions = clipCaptions.filter(cap => {
            const clipStart = cap.startTime ?? 0;
            const clipEnd = cap.endTime ?? slideDuration;
            return timeInSlide >= clipStart && timeInSlide <= clipEnd;
        });

        if (showHookOverlay && script) {
            ctx.filter = 'none';
            let hookText = script.hook || '';
            if (subtitleSettings.uppercase) hookText = hookText.toUpperCase();

            const hookTitleFontSize = 36;
            const hookBodyFontSize = 42;
            const paddingX = 70;
            const paddingY = 50;
            const maxWidth = width - paddingX * 2;

            ctx.font = `800 ${hookBodyFontSize}px "${subtitleSettings.fontFamily || 'Montserrat'}", sans-serif`;
            // @ts-ignore
            if (subtitleSettings.letterSpacing) ctx.letterSpacing = `${subtitleSettings.letterSpacing}px`;

            ctx.textAlign = 'center';
            ctx.textBaseline = 'middle';

            const words = hookText.split(' ');
            const lines: string[] = [];
            let currentLine = '';
            words.forEach(word => {
                const tentative = currentLine ? `${currentLine} ${word}` : word;
                if (ctx.measureText(tentative).width < maxWidth) {
                    currentLine = tentative;
                } else {
                    lines.push(currentLine);
                    currentLine = word;
                }
            });
            if (currentLine) lines.push(currentLine);

            const totalHeight = lines.length * hookBodyFontSize * 1.2 + paddingY;
            const boxWidth = Math.min(maxWidth + paddingX, width - 120);
            const startX = width / 2 - boxWidth / 2;
            const startY = height * 0.15;

            ctx.save();
            ctx.fillStyle = 'rgba(10, 8, 20, 0.78)';
            ctx.strokeStyle = 'rgba(255,255,255,0.1)';
            ctx.lineWidth = 2;
            ctx.beginPath();
            ctx.roundRect(startX, startY, boxWidth, totalHeight, 28);
            ctx.fill();
            ctx.stroke();

            ctx.fillStyle = '#FFFFFF';
            ctx.font = `800 ${hookBodyFontSize}px "${subtitleSettings.fontFamily || 'Montserrat'}", sans-serif`;
            lines.forEach((line, idx) => {
                const y = startY + paddingY / 2 + (idx + 0.5) * hookBodyFontSize * 1.2;
                ctx.fillText(line, width / 2, y);
            });
            ctx.restore();

            // @ts-ignore
            if (subtitleSettings.letterSpacing) ctx.letterSpacing = '0px';

        } else if (enableCaptions && activeClipCaptions.length > 0) {
            ctx.filter = 'none';
            const defaultFont = subtitleSettings.fontFamily || 'Inter';

            activeClipCaptions.forEach((cap, idx) => {
                let text = cap.text || '';
                if (subtitleSettings.uppercase) text = text.toUpperCase();

                const fontSize = cap.fontSize || subtitleSettings.fontSize || 24;
                const fontFamily = cap.fontFamily || defaultFont;
                const color = cap.color || subtitleSettings.color || '#FFFFFF';
                const bgColor = cap.backgroundColor || (cap.stylePreset === 'bold-pop' ? 'rgba(0,0,0,0.65)' : 'rgba(0,0,0,0.4)');
                const animation = cap.animation || 'none';
                const totalLines = text.split('\n');

                ctx.font = `700 ${fontSize}px "${fontFamily}", sans-serif`;
                // @ts-ignore
                if (subtitleSettings.letterSpacing) ctx.letterSpacing = `${subtitleSettings.letterSpacing}px`;

                ctx.textAlign = 'center';
                ctx.textBaseline = 'middle';

                const lineHeight = fontSize * 1.25;
                const textWidth = Math.max(...totalLines.map(line => ctx.measureText(line).width));
                const paddingX = 28;
                const paddingY = 18;
                const boxWidth = Math.min(textWidth + paddingX * 2, width - 60);
                const boxHeight = lineHeight * totalLines.length + paddingY * 2;

                const position = cap.position || 'bottom';
                let yPercent = cap.yPercent;
                if (position === 'top') yPercent = 20;
                else if (position === 'middle') yPercent = 50;
                else if (position === 'bottom') yPercent = 80;
                const baseY = ((yPercent ?? 80) / 100) * height;
                const y = baseY + idx * (boxHeight + 12) - (boxHeight / 2);

                const xPercent = cap.xPercent ?? 50;
                const xCenter = (xPercent / 100) * width;
                const startX = xCenter - boxWidth / 2;

                ctx.save();
                if (animation === 'fade') {
                    const alpha = Math.min(1, Math.max(0, (timeInSlide - (cap.startTime ?? 0)) / 0.3));
                    ctx.globalAlpha = alpha;
                } else if (animation === 'slide') {
                    const progress = Math.min(1, Math.max(0, (timeInSlide - (cap.startTime ?? 0)) / 0.4));
                    ctx.translate(0, (1 - progress) * 20);
                    ctx.globalAlpha = progress;
                }

                ctx.fillStyle = bgColor;
                ctx.beginPath();
                ctx.roundRect(startX, y, boxWidth, boxHeight, 18);
                ctx.fill();

                ctx.fillStyle = color;
                totalLines.forEach((line, lineIdx) => {
                    const lineY = y + paddingY + lineIdx * lineHeight + lineHeight / 2;
                    ctx.fillText(line, xCenter, lineY);
                });
                ctx.restore();
            });

            // @ts-ignore
            if (subtitleSettings.letterSpacing) ctx.letterSpacing = '0px';

        } else if (enableCaptions && isActive && script?.segments && script.segments[currentIndex] && displayTime > 0.1) {
            const plan = script.segmentPlans?.[currentIndex];
            const voicedText = (plan?.voiceoverText || '').trim();
            const plannedText = (plan?.onScreenText || '').trim();
            // Keep derived captions aligned with the spoken line by default.
            let segmentText = (voicedText || plannedText || script.segments[currentIndex] || '').trim();
            if (!segmentText) return;
            if (subtitleSettings.uppercase) segmentText = segmentText.toUpperCase();

            ctx.filter = 'none';

            const fontSize = subtitleSettings.fontSize || 24;
            const fontFamily = subtitleSettings.fontFamily || 'Inter';
            const fillColor = subtitleSettings.fillColor || subtitleSettings.color || '#FFFFFF';
            const outlineColor = subtitleSettings.outlineColor || '#000000';
            const highlightColor = subtitleSettings.highlightColor || '#FFFF00';
            const glowColor = subtitleSettings.glowColor || '#00FFFF';
            const glowIntensity = subtitleSettings.glowIntensity || 10;
            const strokeWidth = subtitleSettings.strokeWidth || 6;
            const style = subtitleSettings.style || 'viral';
            const displayMode = subtitleSettings.displayMode || 'sentence';
            const animation = subtitleSettings.animation || 'none';
            const backgroundShape = subtitleSettings.backgroundShape || 'none';
            const backgroundOpacity = subtitleSettings.backgroundOpacity || 0.7;
            const popScale = subtitleSettings.popScale || 1.2;

            ctx.font = `800 ${fontSize}px "${fontFamily}", sans-serif`;
            // @ts-ignore
            if (subtitleSettings.letterSpacing) ctx.letterSpacing = `${subtitleSettings.letterSpacing}px`;

            ctx.textAlign = (subtitleSettings.textAlign as CanvasTextAlign) || 'center';
            ctx.textBaseline = 'middle';

            const maxWidth = width - 80;
            const lineHeight = fontSize * 1.35;
            const words = segmentText.split(' ');

            // Word-by-word mode: calculate which word should be highlighted
            let highlightWordIndex = -1;
            let wordHighlightProgress = 0;
            if (displayMode === 'word-by-word' && words.length > 0) {
                const measuredVoiceDuration = Number(audioSegmentDurations?.[currentIndex]) || slideDuration;
                wordHighlightProgress = Math.max(
                    0,
                    Math.min(1, measuredVoiceDuration > 0 ? (timeInSlide / measuredVoiceDuration) : 0),
                );
                highlightWordIndex = Math.min(Math.floor(wordHighlightProgress * words.length), words.length - 1);
            }

            // Build lines for wrapping
            let lines: string[] = [];
            let lineWordIndices: number[][] = []; // Track word indices per line
            let currentLine = '';
            let currentLineIndices: number[] = [];

            words.forEach((word, wordIdx) => {
                const tentative = currentLine ? `${currentLine} ${word}` : word;
                if (ctx.measureText(tentative).width < maxWidth) {
                    currentLine = tentative;
                    currentLineIndices.push(wordIdx);
                } else {
                    if (currentLine) {
                        lines.push(currentLine);
                        lineWordIndices.push(currentLineIndices);
                    }
                    currentLine = word;
                    currentLineIndices = [wordIdx];
                }
            });
            if (currentLine) {
                lines.push(currentLine);
                lineWordIndices.push(currentLineIndices);
            }
            if (lines.length > 6) {
                lines = lines.slice(0, 6);
                lineWordIndices = lineWordIndices.slice(0, 6);
            }

            const totalTextHeight = lines.length * lineHeight;
            const startY = (height * (subtitleSettings.yPosition / 100)) - (totalTextHeight / 2);

            let xPos = width / 2;
            if (subtitleSettings.textAlign === 'left') xPos = 60;
            if (subtitleSettings.textAlign === 'right') xPos = width - 60;

            // Calculate animation transforms
            ctx.save();
            const animProgress = Math.min(1, timeInSlide / 0.3);

            // Track shimmer state for text rendering
            let shimmerOffset = 0;
            let typewriterVisibleChars = -1; // -1 means show all
            let colorShiftHue = 0;
            let pulseScale = 1;
            let shakeX = 0, shakeY = 0;

            if (animation === 'fade') {
                ctx.globalAlpha = animProgress;
            } else if (animation === 'pop' || animation === 'bounce') {
                const scale = animation === 'bounce'
                    ? 1 + (popScale - 1) * Math.sin(animProgress * Math.PI) * (1 - animProgress * 0.5)
                    : 1 + (popScale - 1) * (1 - animProgress);
                ctx.translate(xPos, startY + totalTextHeight / 2);
                ctx.scale(scale, scale);
                ctx.translate(-xPos, -(startY + totalTextHeight / 2));
                ctx.globalAlpha = animProgress;
            } else if (animation === 'slide') {
                ctx.translate(0, (1 - animProgress) * 30);
                ctx.globalAlpha = animProgress;
            } else if (animation === 'zoom') {
                const scale = 0.5 + animProgress * 0.5;
                ctx.translate(xPos, startY + totalTextHeight / 2);
                ctx.scale(scale, scale);
                ctx.translate(-xPos, -(startY + totalTextHeight / 2));
                ctx.globalAlpha = animProgress;
            } else if (animation === 'shimmer') {
                // Shimmer: horizontal bright band sweeping across text (2s cycle)
                shimmerOffset = ((timeInSlide % 2) / 2) * (width + 200) - 100;
                ctx.globalAlpha = animProgress;
            } else if (animation === 'typewriter') {
                // Typewriter: reveal characters one by one (~30 chars/sec)
                const totalChars = segmentText.length;
                const charsPerSecond = 25;
                typewriterVisibleChars = Math.floor(timeInSlide * charsPerSecond);
                ctx.globalAlpha = 1;
            } else if (animation === 'colorShift') {
                // Color shift: cycle through hues (3s cycle)
                colorShiftHue = (timeInSlide % 3) / 3 * 360;
                ctx.globalAlpha = animProgress;
            }

            // ── Advanced Text Animation Presets (from motionEngine) ──────
            const textAnimPreset = visualSettings.perSceneOverrides?.[currentIndex]?.textAnimation
                ?? visualSettings.textAnimation
                ?? 'none';
            if (textAnimPreset !== 'none') {
                const wordCount = words.length;
                const textAnimT = Math.min(1, timeInSlide / Math.max(0.5, slideDuration * 0.4));
                const textAnim = computeTextAnimation(textAnimPreset as TextAnimationPreset, textAnimT, wordCount);

                if (textAnim.offsetY !== 0) {
                    ctx.translate(0, textAnim.offsetY);
                }
                if (textAnim.opacity < 1) {
                    ctx.globalAlpha = Math.min(ctx.globalAlpha, textAnim.opacity);
                }
                if (textAnim.glitchOffset > 0) {
                    // Glitch: draw text twice with offset
                    ctx.save();
                    ctx.globalCompositeOperation = 'screen';
                    ctx.fillStyle = '#FF0040';
                    lines.forEach((line, lineIdx) => {
                        const lineY = startY + lineIdx * lineHeight + lineHeight / 2;
                        ctx.fillText(line, xPos + textAnim.glitchOffset, lineY);
                    });
                    ctx.fillStyle = '#00FFFF';
                    lines.forEach((line, lineIdx) => {
                        const lineY = startY + lineIdx * lineHeight + lineHeight / 2;
                        ctx.fillText(line, xPos - textAnim.glitchOffset, lineY);
                    });
                    ctx.restore();
                }
            } else if (animation === 'pulse') {
                // Pulse: subtle continuous scale breathing (1.5s cycle)
                pulseScale = 1 + 0.05 * Math.sin(timeInSlide * Math.PI * 2 / 1.5);
                ctx.translate(xPos, startY + totalTextHeight / 2);
                ctx.scale(pulseScale, pulseScale);
                ctx.translate(-xPos, -(startY + totalTextHeight / 2));
                ctx.globalAlpha = animProgress;
            } else if (animation === 'shake') {
                // Shake: random jitter effect (high frequency)
                const intensity = 3;
                shakeX = (Math.random() - 0.5) * intensity * 2;
                shakeY = (Math.random() - 0.5) * intensity * 2;
                ctx.translate(shakeX, shakeY);
                ctx.globalAlpha = animProgress;
            } else if (animation === 'wave') {
                // Wave is handled per-word below
                ctx.globalAlpha = animProgress;
            }

            // Draw background shape
            if (backgroundShape !== 'none') {
                let maxW = 0;
                lines.forEach(l => { const w = ctx.measureText(l).width; if (w > maxW) maxW = w; });
                const padding = backgroundShape === 'pill' ? 24 : backgroundShape === 'highlight' ? 12 : 20;
                const bgHeight = totalTextHeight + padding * 2;
                const bgWidth = maxW + padding * 2;

                let boxX = xPos - bgWidth / 2;
                if (subtitleSettings.textAlign === 'left') boxX = xPos - padding;
                if (subtitleSettings.textAlign === 'right') boxX = xPos - maxW - padding;

                ctx.fillStyle = backgroundShape === 'highlight'
                    ? `rgba(255, 255, 0, ${backgroundOpacity * 0.6})`
                    : `rgba(0, 0, 0, ${backgroundOpacity})`;

                ctx.beginPath();
                if (backgroundShape === 'pill') {
                    ctx.roundRect(boxX, startY - padding, bgWidth, bgHeight, bgHeight / 2);
                } else if (backgroundShape === 'bubble') {
                    ctx.roundRect(boxX, startY - padding, bgWidth, bgHeight, 24);
                    // Draw bubble tail
                    ctx.moveTo(xPos - 10, startY + bgHeight - padding);
                    ctx.lineTo(xPos, startY + bgHeight - padding + 15);
                    ctx.lineTo(xPos + 10, startY + bgHeight - padding);
                } else if (backgroundShape === 'highlight') {
                    // Draw per-line highlight markers
                    lines.forEach((line, i) => {
                        const lineW = ctx.measureText(line).width;
                        const lineY = startY + (i * lineHeight);
                        let lineX = xPos - lineW / 2 - 8;
                        if (subtitleSettings.textAlign === 'left') lineX = xPos - 8;
                        if (subtitleSettings.textAlign === 'right') lineX = xPos - lineW - 8;
                        ctx.roundRect(lineX, lineY - 4, lineW + 16, lineHeight, 4);
                    });
                } else {
                    ctx.roundRect(boxX, startY - padding, bgWidth, bgHeight, 12);
                }
                ctx.fill();
            }

            // Style-specific rendering
            const renderText = (text: string, x: number, y: number, isHighlighted: boolean = false) => {
                ctx.save();

                // Determine colors based on style and highlight state
                let currentFill = isHighlighted ? highlightColor : fillColor;
                let currentOutline = outlineColor;

                // Apply style-specific effects
                if (style === 'neon' || style === 'karaoke') {
                    // Neon effect: dark outline for readability + colored glow
                    const neonColor = isHighlighted ? highlightColor : glowColor;

                    // Layer 1: Dark outline for contrast/readability
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = strokeWidth + 4;
                    ctx.strokeText(text, x, y);

                    // Layer 2: Outer glow (large blur)
                    ctx.shadowColor = neonColor;
                    ctx.shadowBlur = glowIntensity * 2;
                    ctx.fillStyle = currentFill;
                    ctx.fillText(text, x, y);

                    // Layer 3: Inner glow (medium blur)
                    ctx.shadowBlur = glowIntensity;
                    ctx.fillText(text, x, y);

                    // Layer 4: Core text (sharp, no blur)
                    ctx.shadowBlur = 0;
                    ctx.fillStyle = currentFill;
                    ctx.fillText(text, x, y);

                    // Layer 5: Bright center highlight
                    ctx.fillStyle = '#FFFFFF';
                    ctx.globalAlpha = 0.3;
                    ctx.fillText(text, x, y);
                    ctx.globalAlpha = 1;
                } else if (style === 'gradient' && subtitleSettings.gradientColors) {
                    // Gradient text fill with strong outline for readability
                    const textWidth = ctx.measureText(text).width;
                    const gradient = ctx.createLinearGradient(x - textWidth / 2, y, x + textWidth / 2, y);
                    gradient.addColorStop(0, subtitleSettings.gradientColors[0]);
                    gradient.addColorStop(1, subtitleSettings.gradientColors[1]);

                    // Dark outline for contrast
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = strokeWidth + 2;
                    ctx.strokeText(text, x, y);

                    // Gradient fill
                    ctx.fillStyle = gradient;
                    ctx.fillText(text, x, y);

                    // Optional glow effect
                    if (glowIntensity > 0) {
                        ctx.shadowColor = subtitleSettings.gradientColors[0];
                        ctx.shadowBlur = glowIntensity * 0.5;
                        ctx.fillText(text, x, y);
                        ctx.shadowBlur = 0;
                    }
                } else if (style === 'outline') {
                    // Thick outline with dark background for readability
                    // Dark inner fill for contrast
                    ctx.fillStyle = 'rgba(0,0,0,0.5)';
                    ctx.fillText(text, x, y);
                    // Colored outline
                    ctx.strokeStyle = currentFill;
                    ctx.lineWidth = strokeWidth + 2;
                    ctx.strokeText(text, x, y);
                } else if (style === 'shadow' || style === 'cinematic') {
                    // Cinematic: elegant drop shadow with subtle glow
                    // Multiple shadow layers for depth
                    ctx.shadowColor = 'rgba(0,0,0,0.9)';
                    ctx.shadowBlur = style === 'cinematic' ? 8 : 12;
                    ctx.shadowOffsetX = 3;
                    ctx.shadowOffsetY = 3;
                    ctx.fillStyle = currentFill;
                    ctx.fillText(text, x, y);

                    // Second pass for sharper text
                    ctx.shadowBlur = 2;
                    ctx.shadowOffsetX = 1;
                    ctx.shadowOffsetY = 1;
                    ctx.fillText(text, x, y);

                    ctx.shadowBlur = 0;
                    ctx.shadowOffsetX = 0;
                    ctx.shadowOffsetY = 0;
                } else if (style === 'viral') {
                    // Classic viral: thick stroke + fill for maximum readability
                    // Outer dark stroke for extra pop
                    ctx.strokeStyle = '#000000';
                    ctx.lineWidth = strokeWidth + 4;
                    ctx.strokeText(text, x, y);

                    // Colored outline
                    ctx.strokeStyle = currentOutline;
                    ctx.lineWidth = strokeWidth;
                    ctx.strokeText(text, x, y);

                    // White/colored fill
                    ctx.fillStyle = currentFill;
                    ctx.fillText(text, x, y);
                } else if (style === 'clean') {
                    // Clean minimal
                    ctx.fillStyle = currentFill;
                    ctx.shadowColor = 'rgba(0,0,0,0.5)';
                    ctx.shadowBlur = 6;
                    ctx.fillText(text, x, y);
                    ctx.shadowBlur = 0;
                } else if (style === 'box') {
                    // Box style (background handled above)
                    ctx.fillStyle = currentFill;
                    ctx.fillText(text, x, y);
                } else {
                    // Default
                    ctx.fillStyle = currentFill;
                    ctx.strokeStyle = currentOutline;
                    ctx.lineWidth = strokeWidth;
                    if (strokeWidth > 0) ctx.strokeText(text, x, y);
                    ctx.fillText(text, x, y);
                }

                ctx.restore();
            };

            // Render lines (word-by-word or full sentence)
            if (displayMode === 'word-by-word') {
                // Word-by-word karaoke rendering
                lines.forEach((line, lineIdx) => {
                    const y = startY + (lineIdx * lineHeight) + lineHeight / 2;
                    const lineWords = line.split(' ');
                    const wordIndices = lineWordIndices[lineIdx] || [];

                    // Calculate total line width and starting position
                    const lineWidth = ctx.measureText(line).width;
                    let wordX = subtitleSettings.textAlign === 'left' ? xPos
                        : subtitleSettings.textAlign === 'right' ? xPos - lineWidth
                            : xPos - lineWidth / 2;

                    lineWords.forEach((word, wordIdx) => {
                        const globalWordIdx = wordIndices[wordIdx];
                        const isHighlighted = globalWordIdx <= highlightWordIndex;
                        const wordWidth = ctx.measureText(word + ' ').width;

                        // Apply per-word animations
                        let shouldRestore = false;
                        if (isHighlighted && globalWordIdx === highlightWordIndex && (animation === 'pop' || animation === 'bounce')) {
                            ctx.save();
                            shouldRestore = true;
                            const wordAnimProgress = (wordHighlightProgress * words.length) % 1;
                            const wordScale = 1 + 0.1 * Math.sin(wordAnimProgress * Math.PI);
                            ctx.translate(wordX + wordWidth / 2, y);
                            ctx.scale(wordScale, wordScale);
                            ctx.translate(-(wordX + wordWidth / 2), -y);
                        } else if (animation === 'wave') {
                            // Wave: per-word vertical offset based on time and word index
                            ctx.save();
                            shouldRestore = true;
                            const waveOffset = Math.sin((timeInSlide * 4) + globalWordIdx * 0.5) * 8;
                            ctx.translate(0, waveOffset);
                        }

                        renderText(word, wordX + ctx.measureText(word).width / 2, y, isHighlighted);

                        if (shouldRestore) {
                            ctx.restore();
                        }

                        wordX += wordWidth;
                    });
                });
            } else {
                // Full sentence rendering
                lines.forEach((line, i) => {
                    const y = startY + (i * lineHeight) + lineHeight / 2;

                    // Typewriter: only show portion of text
                    let displayLine = line;
                    if (animation === 'typewriter' && typewriterVisibleChars >= 0) {
                        // Calculate chars used by previous lines
                        let charsUsed = 0;
                        for (let j = 0; j < i; j++) {
                            charsUsed += lines[j].length + 1; // +1 for space
                        }
                        const remainingChars = typewriterVisibleChars - charsUsed;
                        if (remainingChars <= 0) {
                            displayLine = ''; // This line not visible yet
                        } else if (remainingChars < line.length) {
                            displayLine = line.substring(0, remainingChars);
                        }
                    }

                    if (displayLine) {
                        renderText(displayLine, xPos, y, false);
                    }
                });

                // Shimmer overlay: draw bright gradient band sweeping across all text
                if (animation === 'shimmer' && shimmerOffset !== undefined) {
                    ctx.save();
                    // Create shimmer gradient
                    const shimmerWidth = 100;
                    const shimmerGradient = ctx.createLinearGradient(
                        shimmerOffset, 0,
                        shimmerOffset + shimmerWidth, 0
                    );
                    shimmerGradient.addColorStop(0, 'rgba(255,255,255,0)');
                    shimmerGradient.addColorStop(0.5, 'rgba(255,255,255,0.6)');
                    shimmerGradient.addColorStop(1, 'rgba(255,255,255,0)');

                    // Draw shimmer over text area
                    ctx.globalCompositeOperation = 'source-atop';
                    ctx.fillStyle = shimmerGradient;
                    ctx.fillRect(0, startY - 20, width, totalTextHeight + 40);
                    ctx.restore();
                }
            }

            ctx.restore();

            // Reset letterSpacing
            // @ts-ignore
            if (subtitleSettings.letterSpacing) ctx.letterSpacing = '0px';
        }

    }, [duration, media, script?.segments, script?.segmentPlans, timeline, videoSpeed, visualSettings, subtitleSettings, audioMixSettings, audioSegmentDurations, enableCaptions, syncClipAudioLevels]);

    // Audio Playback
    const applyFade = useCallback((gainNode: GainNode | null, target: number, duration: number) => {
        if (!gainNode || !audioContextRef.current) return;
        const now = audioContextRef.current.currentTime;
        const param = gainNode.gain;
        param.cancelScheduledValues(now);
        param.linearRampToValueAtTime(target, now + duration);
    }, []);

    const startDucking = useCallback(() => {
        if (!audioMixSettings.enableDucking || !audioContextRef.current) return;
        const reduction = (audioMixSettings.duckingAmount ?? 0.5);
        const duckedMusic = Math.max(0, audioMixSettings.musicVolume * (1 - reduction));
        const clipVolume = Math.max(0, Math.min(1, audioMixSettings.clipVolume ?? 0));
        const duckedClip = Math.max(0, clipVolume * (1 - reduction));
        if (musicGainRef.current) {
            applyFade(musicGainRef.current, duckedMusic, 0.2);
        }
        // Duck per-video gains for the active clip rather than the bus (bus stays at 1 for export tap).
        videoClipGainMapRef.current.forEach((gain) => {
            if (gain.gain.value > 0) applyFade(gain, duckedClip, 0.2);
        });
    }, [audioMixSettings, applyFade]);

    const stopDucking = useCallback(() => {
        if (musicGainRef.current) {
            applyFade(musicGainRef.current, audioMixSettings.musicVolume, 0.4);
        }
        const clipVolume = Math.max(0, Math.min(1, audioMixSettings.clipVolume ?? 0));
        // Ramp ducked clip gains back up; inactive clips stay at 0 via syncClipAudioLevels.
        videoClipGainMapRef.current.forEach((gain) => {
            if (gain.gain.value > 0.001) {
                applyFade(gain, clipVolume, 0.4);
            }
        });
    }, [audioMixSettings.musicVolume, audioMixSettings.clipVolume, applyFade]);

    const scheduleVoiceCallbacks = useCallback((source: AudioBufferSourceNode | null) => {
        if (!source || !audioMixSettings.enableDucking) return;
        source.onended = () => {
            stopDucking();
        };
    }, [audioMixSettings.enableDucking, stopDucking]);

    const stopAudio = useCallback((withFade: boolean) => {
        const fadeDuration = withFade ? (audioMixSettings.fadeOutDuration || 0) : 0;
        if (fadeDuration > 0) {
            applyFade(musicGainRef.current, 0, fadeDuration);
        }
        const when = audioContextRef.current ? audioContextRef.current.currentTime + fadeDuration : 0;
        // Stop voice HTMLAudioElement
        if (voiceAudioElRef.current) {
            try { voiceAudioElRef.current.pause(); } catch (e) { }
        }
        if (sourceNodeRef.current) {
            try { sourceNodeRef.current.stop(when); } catch (e) { }
            sourceNodeRef.current = null;
        }
        if (musicSourceNodeRef.current) {
            try { musicSourceNodeRef.current.stop(when); } catch (e) { }
            musicSourceNodeRef.current = null;
        }
        stopDucking();
    }, [audioMixSettings.fadeOutDuration, applyFade, stopDucking]);

    const playAudio = useCallback(async (offset: number, requestId: number) => {
        if (!audioContextRef.current) return;
        if (audioContextRef.current.state === 'suspended') {
            await audioContextRef.current.resume();
        }
        if (requestId !== playbackRequestRef.current) return;

        // Stop existing
        stopAudio(false);
        if (requestId !== playbackRequestRef.current) return;

        // Voice uses the sample-preserving scene-aligned buffer.
        if (voicePlaybackBuffer && voiceAudioElRef.current) {
            const el = voiceAudioElRef.current;
            const speed = Math.max(0.1, videoSpeed || 1);
            el.playbackRate = speed;
            (el as any).preservesPitch = true;
            (el as any).preservePitch = true;
            el.volume = audioMixSettings.voiceVolume;
            const safeOffset = Math.min(offset, voicePlaybackBuffer.duration);
            el.currentTime = safeOffset;
            el.play().catch(() => { });
            el.onended = () => { stopDucking(); };
            startDucking();
        }

        // Music
        if (bgMusicBuffer) {
            const src = audioContextRef.current.createBufferSource();
            src.buffer = bgMusicBuffer;
            src.loop = true;
            // Music uses playbackRate for speed (pitch shift is acceptable for music).
            // No detune — we want the music to actually play faster.
            src.playbackRate.value = videoSpeed;
            const gain = audioContextRef.current.createGain();
            gain.gain.value = audioMixSettings.musicVolume;
            src.connect(gain);
            gain.connect(audioContextRef.current.destination);
            const musicOffset = offset % bgMusicBuffer.duration;
            src.start(0, musicOffset);
            if (audioMixSettings.fadeInDuration && offset === 0) {
                gain.gain.setValueAtTime(0, audioContextRef.current.currentTime);
                applyFade(gain, audioMixSettings.musicVolume, audioMixSettings.fadeInDuration);
            }
            musicSourceNodeRef.current = src;
            musicGainRef.current = gain;
        }

        playbackOffsetRef.current = offset; // timeline seconds
        playbackSpeedRef.current = effectiveTimelineRate;
        contextStartRef.current = audioContextRef.current.currentTime;
    }, [voicePlaybackBuffer, bgMusicBuffer, audioMixSettings, applyFade, startDucking, scheduleVoiceCallbacks, effectivePlaybackSpeed, videoSpeed, stopAudio, isExporting]);

    useEffect(() => {
        const prevSpeed = playbackSpeedRef.current || 1;
        if (audioContextRef.current) {
            const now = audioContextRef.current.currentTime;
            const elapsed = now - contextStartRef.current;
            const currentTimelineTime = playbackOffsetRef.current + elapsed * prevSpeed;
            playbackOffsetRef.current = currentTimelineTime;
            contextStartRef.current = now;
        }
        playbackSpeedRef.current = effectiveTimelineRate;

        // Voice: HTMLAudioElement with preservesPitch handles speed cleanly.
        if (voiceAudioElRef.current) {
            voiceAudioElRef.current.playbackRate = Math.max(0.1, videoSpeed || 1);
        }
        // Music: playbackRate for speed (pitch shift is acceptable for music).
        if (musicSourceNodeRef.current) {
            musicSourceNodeRef.current.playbackRate.value = effectiveTimelineRate;
        }
    }, [effectiveTimelineRate, videoSpeed, effectivePlaybackSpeed, isExporting]);

    // Main Playback Effect
    useEffect(() => {
        if (isPlaying && !isExporting) {
            let startOffset = currentTime;

            // Auto-Rewind if at end
            if (Math.abs(duration - currentTime) < 0.1 || currentTime >= duration) {
                startOffset = 0;
                setCurrentTime(0);
                playbackOffsetRef.current = 0;
            }

            const requestId = playbackRequestRef.current + 1;
            playbackRequestRef.current = requestId;
            void playAudio(startOffset, requestId);
        } else {
            playbackRequestRef.current += 1;
            // Capture current timeline position so resume starts in-sync
            if (audioContextRef.current) {
                const now = audioContextRef.current.currentTime;
                const elapsed = now - contextStartRef.current;
                const speed = playbackSpeedRef.current || 1;
                playbackOffsetRef.current = playbackOffsetRef.current + elapsed * speed;
                contextStartRef.current = now;
            }
            stopAudio(false);
            Object.values(videoElementsRef.current).forEach((video) => {
                if (video instanceof HTMLVideoElement) video.pause();
            });
        }
    }, [isPlaying, isExporting, playAudio, duration, stopAudio]);

    // Loop for rendering
    useEffect(() => {
        if (isExporting) return;
        const render = () => {
            if (!canvasRef.current) return;
            const ctx = canvasRef.current.getContext('2d');
            if (!ctx) return;

            let displayTime = currentTime;

            if (isPlaying && audioContextRef.current) {
                const elapsed = audioContextRef.current.currentTime - contextStartRef.current;
                const speed = playbackSpeedRef.current || 1;
                displayTime = playbackOffsetRef.current + elapsed * speed;
                if (displayTime >= duration && duration > 0) {
                    onRestart(); // Notify parent to stop playing
                    return;
                }
                setCurrentTime(displayTime);
            }

            if (!isExporting && onSceneChange) {
                const nextSceneIndex = getSceneIndexForDisplayTime(displayTime, timeline, media.length, timelineDuration || duration);
                if (nextSceneIndex !== lastReportedSceneIndexRef.current) {
                    lastReportedSceneIndexRef.current = nextSceneIndex;
                    onSceneChange(nextSceneIndex);
                }
            }

            drawFrame(ctx, displayTime, isPlaying || isExporting);
            animationRef.current = requestAnimationFrame(render);
        };
        animationRef.current = requestAnimationFrame(render);
        return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
    }, [isPlaying, currentTime, duration, drawFrame, isExporting, media.length, onRestart, onSceneChange, timeline, timelineDuration]);

    // Stop all audio when component unmounts (e.g. navigating away from preview)
    useEffect(() => {
        return () => {
            stopAudio(false);
            if (voiceAudioElRef.current) {
                voiceAudioElRef.current.pause();
                voiceAudioElRef.current = null;
            }
            if (voiceAudioUrlRef.current) {
                URL.revokeObjectURL(voiceAudioUrlRef.current);
                voiceAudioUrlRef.current = null;
            }
            Object.values(videoElementsRef.current).forEach((video) => {
                if (video instanceof HTMLVideoElement) video.pause();
            });
        };
    }, [stopAudio]);

    const handleReplay = () => {
        playbackRequestRef.current += 1;
        stopAudio(false);
        media.forEach((item, idx) => {
            const video = videoElementsRef.current[idx];
            if (video && video instanceof HTMLVideoElement) {
                video.pause();
                const resetTime = item.startTime || 0;
                if (!Number.isNaN(resetTime)) video.currentTime = resetTime;
            }
        });
        setCurrentTime(0);
        playbackOffsetRef.current = 0;
        if (audioContextRef.current) contextStartRef.current = audioContextRef.current.currentTime;
        if (canvasRef.current) {
            const ctx = canvasRef.current.getContext('2d');
            if (ctx) drawFrame(ctx, 0, false);
        }
        if (!isPlaying) onPlayToggle();
    };

    const handleDownload = useCallback(async (format: ExportFormat) => {
        console.log('[ReelPreview] handleDownload started', format);
        if (exportActiveRef.current || isExporting) {
            return;
        }
        if (typeof MediaRecorder === 'undefined') {
            alert('This browser does not support MediaRecorder export.');
            return;
        }
        if (!canvasRef.current || !audioContextRef.current) {
            console.error('[ReelPreview] Missing canvas or audio context');
            return;
        }
        if (voiceTimelineInvalid) {
            const scenes = invalidVoiceSceneIndexes.map((index) => index + 1).join(', ');
            alert(
                `Export blocked: narration exceeds the timeline in scene${invalidVoiceSceneIndexes.length === 1 ? '' : 's'} ${scenes}. `
                + 'Return to Clip Studio to unlock and fit timing, or shorten the script and regenerate voice.',
            );
            return;
        }

        const supportedMime = !format.mime || MediaRecorder.isTypeSupported(format.mime)
            ? format.mime
            : (formatsToShow.find((candidate) => !candidate.mime || MediaRecorder.isTypeSupported(candidate.mime))?.mime || '');

        if (format.mime && !supportedMime) {
            alert('No supported export format is available in this browser.');
            return;
        }

        setShowExportModal(false);
        setIsExporting(true);
        setExportProgress(0);
        exportActiveRef.current = true;

        let stream: MediaStream | null = null;
        let dest: MediaStreamAudioDestinationNode | null = null;
        let exportSourceVoice: AudioBufferSourceNode | null = null;
        let exportSourceMusic: AudioBufferSourceNode | null = null;

        const cleanupExport = () => {
            exportActiveRef.current = false;
            setIsExporting(false);
            setExportProgress(0);
            exportStartRef.current = null;
            exportDurationRef.current = 0;
            recorderRef.current = null;
            try { exportSourceVoice?.stop(); } catch { }
            try { exportSourceMusic?.stop(); } catch { }
            try { exportSilenceRef.current?.stop(); } catch { }
            exportSilenceRef.current = null;
            // Detach clip bus from this export destination only (keep preview speaker connection).
            if (dest && clipBusGainRef.current) {
                try { clipBusGainRef.current.disconnect(dest); } catch { }
            }
            if (stream && typeof stream.getTracks === 'function') {
                stream.getTracks().forEach(track => track.stop());
            }
            if (dest?.stream && typeof dest.stream.getTracks === 'function') {
                dest.stream.getTracks().forEach(track => track.stop());
            }
        };

        try {
            const ac = audioContextRef.current!;
            if (ac.state === 'suspended') await ac.resume();
            const ctx = canvasRef.current.getContext('2d');
            if (!ctx) {
                console.error('[ReelPreview] Could not get 2D context');
                cleanupExport();
                return;
            }

            const exportW = format.width || CANVAS_WIDTH;
            const exportH = format.height || CANVAS_HEIGHT;
            const needsResize = exportW !== CANVAS_WIDTH || exportH !== CANVAS_HEIGHT;
            let exportCanvas: HTMLCanvasElement | null = null;
            let exportCtx2d: CanvasRenderingContext2D | null = null;

            if (needsResize) {
                exportCanvas = document.createElement('canvas');
                exportCanvas.width = exportW;
                exportCanvas.height = exportH;
                exportCtx2d = exportCanvas.getContext('2d');
            }

            const drawExportFrame = (time: number) => {
                drawFrame(ctx, time, true);
                if (exportCtx2d && exportCanvas) {
                    const srcAspect = CANVAS_WIDTH / CANVAS_HEIGHT;
                    const dstAspect = exportW / exportH;
                    let sx = 0, sy = 0, sw = CANVAS_WIDTH, sh = CANVAS_HEIGHT;
                    if (srcAspect < dstAspect) {
                        sh = CANVAS_WIDTH / dstAspect;
                        sy = (CANVAS_HEIGHT - sh) / 2;
                    } else if (srcAspect > dstAspect) {
                        sw = CANVAS_HEIGHT * dstAspect;
                        sx = (CANVAS_WIDTH - sw) / 2;
                    }
                    exportCtx2d.drawImage(canvasRef.current!, sx, sy, sw, sh, 0, 0, exportW, exportH);
                }
            };

            drawExportFrame(0);
            await new Promise(resolve => setTimeout(resolve, 100));

            console.log(`[ReelPreview] Capturing stream at ${exportW}x${exportH}...`);
            const captureTarget = exportCanvas || canvasRef.current;
            stream = captureTarget.captureStream(30);
            dest = audioContextRef.current.createMediaStreamDestination();

            let exportMusicGain: GainNode | null = null;
            let hasClipAudio = false;
            if (voicePlaybackBuffer && voiceAudioElRef.current) {
                // Route HTMLAudioElement through AudioContext for export capture.
                // preservesPitch ensures no pitch shift at any playbackRate.
                const el = voiceAudioElRef.current;
                el.playbackRate = Math.max(0.1, videoSpeed || 1);
                (el as any).preservesPitch = true;
                (el as any).preservePitch = true;
                el.volume = audioMixSettings.voiceVolume;
                el.currentTime = 0;
                // createMediaElementSource can only be called once per element.
                // Once created, the element's output is routed through AudioContext,
                // so we must also connect to destination for normal preview playback.
                if (!voiceMediaSourceRef.current) {
                    voiceMediaSourceRef.current = ac.createMediaElementSource(el);
                    voiceMediaSourceRef.current.connect(ac.destination);
                }
                const gain = ac.createGain();
                gain.gain.value = audioMixSettings.voiceVolume;
                voiceMediaSourceRef.current.connect(gain);
                gain.connect(dest);
                exportSourceVoice = { start: (t: number) => { el.play().catch(() => {}); }, stop: () => { el.pause(); } } as any;
            }
            if (bgMusicBuffer) {
                const source = ac.createBufferSource();
                source.buffer = bgMusicBuffer;
                source.loop = true;
                source.playbackRate.value = Math.max(0.1, videoSpeed || 1);
                const gain = ac.createGain();
                gain.gain.value = audioMixSettings.musicVolume;
                source.connect(gain);
                gain.connect(dest);
                exportSourceMusic = source;
                exportMusicGain = gain;
            }

            // Tap original clip audio into the export destination (same bus as preview).
            const clipVolume = Math.max(0, Math.min(1, audioMixSettings.clipVolume ?? 0));
            if (clipVolume > 0) {
                Object.values(videoElementsRef.current).forEach((video) => {
                    if (video instanceof HTMLVideoElement) {
                        ensureVideoClipInMix(video);
                    }
                });
                const bus = ensureClipBus();
                if (bus) {
                    bus.connect(dest);
                    hasClipAudio = videoClipGainMapRef.current.size > 0;
                }
            }

            if (exportSourceVoice && exportMusicGain && voicePlaybackBuffer && audioMixSettings.enableDucking) {
                const reduction = audioMixSettings.duckingAmount ?? 0.5;
                const duckedVol = Math.max(0, audioMixSettings.musicVolume * (1 - reduction));
                const voiceDur = voicePlaybackBuffer.duration / Math.max(0.1, videoSpeed || 1);
                exportMusicGain.gain.setValueAtTime(audioMixSettings.musicVolume, ac.currentTime);
                exportMusicGain.gain.linearRampToValueAtTime(duckedVol, ac.currentTime + 0.2);
                exportMusicGain.gain.setValueAtTime(duckedVol, ac.currentTime + voiceDur);
                exportMusicGain.gain.linearRampToValueAtTime(audioMixSettings.musicVolume, ac.currentTime + voiceDur + 0.4);
            }

            const videoTracks = stream.getVideoTracks();
            const audioTracks = (exportSourceVoice || exportSourceMusic || hasClipAudio) ? dest.stream.getAudioTracks() : [];
            const combined = new MediaStream([...videoTracks, ...audioTracks]);
            console.log(`[ReelPreview] Tracks combined: ${videoTracks.length} video, ${audioTracks.length} audio. Stream active: ${combined.active}`);

            const recorderOptions: MediaRecorderOptions = {
                videoBitsPerSecond: format.videoBitsPerSecond || DEFAULT_VIDEO_BITRATE,
            };
            if (audioTracks.length > 0) {
                recorderOptions.audioBitsPerSecond = format.audioBitsPerSecond || DEFAULT_AUDIO_BITRATE;
            }
            if (supportedMime) {
                recorderOptions.mimeType = supportedMime;
            }

            console.log('[ReelPreview] Creating MediaRecorder with options:', JSON.stringify(recorderOptions));
            const recorder = new MediaRecorder(combined, recorderOptions);
            recorderRef.current = recorder;
            const chunks: Blob[] = [];

            recorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    chunks.push(event.data);
                }
            };

            recorder.onerror = (event: any) => {
                const error = event.error || event;
                console.error('[Export] Recorder Error:', error);
                cleanupExport();
                alert(`Export recording failed: ${error?.message || error?.name || 'Unknown Error'}. See console.`);
            };

            recorder.onstop = () => {
                console.log(`[Export] Recorder stopped. Total chunks: ${chunks.length}. Total size: ${chunks.reduce((sum, chunk) => sum + chunk.size, 0)} bytes`);
                try {
                    const blob = new Blob(chunks, { type: supportedMime || format.mime || 'video/webm' });
                    const url = URL.createObjectURL(blob);
                    const link = document.createElement('a');
                    link.href = url;
                    link.download = `reel.${format.ext}`;
                    link.click();
                    setTimeout(() => URL.revokeObjectURL(url), 5000);
                } finally {
                    cleanupExport();
                }
            };

            const effectiveDurations = effectiveTimelineDurations.length ? effectiveTimelineDurations : media.map(deriveClipDuration);
            const timelineTotal = effectiveDurations.reduce((sum, clipDuration) => sum + clipDuration, 0);
            const safeVideoSpeed = Math.max(0.1, videoSpeed || 1);
            const exportDuration = Math.max(timelineTotal / safeVideoSpeed, 0.01);
            exportDurationRef.current = exportDuration;

            const exportBuffer = voicePlaybackBuffer;
            const narrationPlaybackDuration = exportBuffer
                ? exportBuffer.duration / safeVideoSpeed
                : 0;
            if (exportBuffer && narrationPlaybackDuration > exportDuration + 0.01) {
                alert(
                    `Export blocked: measured narration needs at least ${exportBuffer.duration.toFixed(1)}s, `
                    + `but the timeline is ${timelineTotal.toFixed(1)}s. `
                    + 'Fit the timeline to measured voice, shorten the offending lines and regenerate, or raise the target.',
                );
                cleanupExport();
                return;
            }

            if (ac.state === 'suspended') await ac.resume();
            await new Promise(resolve => setTimeout(resolve, 50));
            drawExportFrame(0);

            const startCtxTime = ac.currentTime;
            exportStartRef.current = performance.now();
            if (exportSourceVoice) exportSourceVoice.start(startCtxTime);
            if (exportSourceMusic) exportSourceMusic.start(startCtxTime);

            const silence = ac.createBuffer(1, Math.max(1, Math.ceil(ac.sampleRate * (exportDuration + 0.1))), ac.sampleRate);
            const silenceSrc = ac.createBufferSource();
            silenceSrc.buffer = silence;
            silenceSrc.connect(dest);
            silenceSrc.start(startCtxTime);
            exportSilenceRef.current = silenceSrc;

            // Remove timeslice as some browsers (like Safari) throw an error
            // when using timeslices with video/mp4 format.
            recorder.start();

            const animateExport = () => {
                if (!exportActiveRef.current) return;
                const elapsed = ac.currentTime - startCtxTime;
                const progress = Math.min(1, elapsed / exportDuration);
                setExportProgress(progress);

                if (elapsed >= exportDuration) {
                    console.log(`[Export] Finished at ${elapsed.toFixed(2)}s. Total goal: ${exportDuration.toFixed(2)}s`);
                    if (recorder.state === 'recording') {
                        recorder.stop();
                    } else {
                        cleanupExport();
                    }
                    return;
                }

                const displayTime = Math.min(timelineTotal, elapsed * safeVideoSpeed);
                drawExportFrame(displayTime);
                requestAnimationFrame(animateExport);
            };

            animateExport();
        } catch (error) {
            console.error('[Export] Error:', error);
            cleanupExport();
            alert('Export failed. Check console for details.');
        }
    }, [audioBuffer, audioMixSettings.musicVolume, audioMixSettings.voiceVolume, bgMusicBuffer, drawFrame, effectiveTimelineDurations, formatsToShow, invalidVoiceSceneIndexes, isExporting, media, videoSpeed, voicePlaybackBuffer, voiceTimelineInvalid]);

    const handleAutoExport = useCallback(() => {
        if (!exportPresets || !autoExportPresetId) return null;
        const preset = exportPresets.find(p => p.id === autoExportPresetId);
        const fromPreset = preset ? presetToFormat(preset) : null;
        if (fromPreset) return fromPreset;
        return formatsToShow.length ? formatsToShow[0] : null;
    }, [exportPresets, autoExportPresetId, presetToFormat, formatsToShow]);

    useEffect(() => {
        if (!exportTriggerKey || exportTriggerKey === lastHandledTrigger) return;
        const format = handleAutoExport();
        if (!format) return;
        setLastHandledTrigger(exportTriggerKey);
        handleDownload(format);
    }, [exportTriggerKey, lastHandledTrigger, handleAutoExport, handleDownload]);

    return (
        <div className="w-full h-full relative group cursor-pointer" onClick={() => !isExporting && !voiceTimelineInvalid && onPlayToggle()}>
            <canvas
                ref={canvasRef}
                width={CANVAS_WIDTH}
                height={CANVAS_HEIGHT}
                className="w-full h-full object-contain bg-black shadow-2xl rounded-[32px]"
                style={{ aspectRatio: '9 / 16' }}
            />

            {isExporting && (
                <div className="absolute inset-0 bg-black/80 backdrop-blur-md flex flex-col items-center justify-center z-[100] text-center p-8 rounded-[32px]">
                    <div className="w-16 h-16 border-4 border-insta-purple border-t-transparent rounded-full animate-spin mb-6"></div>
                    <h3 className="text-2xl font-black text-white mb-2 italic tracking-tight">RENDERING REEL...</h3>
                    <p className="text-white/80 max-w-xs mx-auto text-sm leading-relaxed font-medium">
                        Please <span className="text-insta-purple font-black underline">KEEP THIS TAB ACTIVE</span>. 
                        Moving to another window will pause the render and corrupt your download.
                    </p>
                    <div className="mt-8 w-full max-w-xs">
                        <div className="h-2 rounded-full bg-white/10 overflow-hidden border border-white/10">
                            <div className="h-full bg-gradient-to-r from-insta-purple to-insta-start transition-all duration-150" style={{ width: `${Math.round(exportProgress * 100)}%` }}></div>
                        </div>
                        <div className="mt-3 px-6 py-2 rounded-full bg-white/10 border border-white/20 text-[10px] uppercase tracking-[0.3em] text-white/50 font-black">
                            Capturing Frames · {Math.round(exportProgress * 100)}%
                        </div>
                    </div>
                </div>
            )}

            {voiceTimelineInvalid && !isExporting && (
                <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/70 p-8 text-center rounded-[32px]">
                    <div className="max-w-sm rounded-2xl border border-amber-400/30 bg-amber-500/10 p-5">
                        <p className="text-sm font-bold text-amber-100">Narration does not fit the current timeline.</p>
                        <p className="mt-2 text-xs leading-relaxed text-amber-100/75">
                            Return to Clip Studio to unlock and fit the affected scenes, or shorten the script and regenerate voice.
                        </p>
                    </div>
                </div>
            )}

            {!isPlaying && !isExporting && !voiceTimelineInvalid && (
                <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                    <div className="w-20 h-20 bg-white/20 backdrop-blur rounded-full flex items-center justify-center border border-white/30">
                        <svg className="w-10 h-10 text-white ml-1" fill="currentColor" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" /></svg>
                    </div>
                </div>
            )}

            <div className="absolute bottom-0 left-0 right-0 p-4 flex justify-between items-center opacity-0 group-hover:opacity-100 transition-opacity bg-gradient-to-t from-black/80 to-transparent">
                <div className="text-white font-mono text-xs">{currentTime.toFixed(1)}s / {duration.toFixed(1)}s</div>
                <div className="flex gap-2">
                    {onVideoSpeedChange && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const speeds = [0.5, 1.0, 1.5, 2.0];
                                const nextSpeed = speeds[(speeds.indexOf(videoSpeed) + 1) % speeds.length] || 1.0;
                                onVideoSpeedChange(nextSpeed);
                            }}
                            className="px-3 py-1.5 bg-black/50 text-white text-xs font-bold rounded-lg hover:bg-white/20 transition-colors border border-white/10"
                            title="Visual Speed"
                        >
                            {videoSpeed}x
                        </button>
                    )}
                    <button onClick={(e) => { e.stopPropagation(); handleReplay(); }} className="p-2 hover:bg-white/20 rounded-full text-white" title="Replay">↺</button>
                    <button onClick={(e) => { e.stopPropagation(); setShowExportModal(true); }} className="px-4 py-1.5 bg-white text-black text-xs font-bold rounded-lg hover:scale-105 transition-transform">Download</button>
                </div>
            </div>

            {showExportModal && (
                <div className="absolute inset-0 bg-black/90 flex items-center justify-center z-50 p-6">
                    <div className="w-full space-y-2">
                        {formatsToShow.map((f, i) => (
                            <button key={i} disabled={isExporting} onClick={(e) => { e.stopPropagation(); handleDownload(f); }} className="w-full p-3 bg-gray-800 border border-gray-700 rounded-xl text-white text-left text-sm hover:border-insta-mid disabled:opacity-50 disabled:cursor-not-allowed">{f.label}</button>
                        ))}
                        <button onClick={(e) => { e.stopPropagation(); setShowExportModal(false); }} className="w-full p-2 text-gray-400 text-xs">Cancel</button>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ReelPreview;
