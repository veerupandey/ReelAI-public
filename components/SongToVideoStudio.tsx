import React, { useState, useRef, useEffect, useCallback } from 'react';
import { UploadedMedia, SongAnalysis, AppStep, MusicMetadata } from '../types';
import { analyzeSongCulturalContext, generateSongVisuals } from '../services/geminiService';
import { processCompatibleBase64, extractMusicMetadata } from '../utils/audioHelper';

const IMAGE_GEN_CONCURRENCY = 3;

export interface SongToVideoState {
    audioUrl: string | null;
    audioBase64?: string | null;
    audioMimeType?: string | null;
    audioDuration: number;
    targetSceneCount: number;
    characterImage: string | null;
    musicMetadata?: MusicMetadata | null;
    analysis: SongAnalysis | null;
    generatedImages: string[];
    step: AppStep;
}

interface SongToVideoStudioProps {
    onBack: () => void;
    onComplete: (media: UploadedMedia[], state: SongToVideoState) => void;
    initialState?: SongToVideoState | null;
}

const resolvePlaybackUrl = (state?: SongToVideoState | null): string | null => {
    if (!state) return null;
    if (state.audioBase64 && state.audioMimeType) {
        return `data:${state.audioMimeType};base64,${state.audioBase64}`;
    }
    if (state.audioUrl && !state.audioUrl.startsWith('blob:')) {
        return state.audioUrl;
    }
    return state.audioUrl;
};

const SongToVideoStudio: React.FC<SongToVideoStudioProps> = ({ onBack, onComplete, initialState }) => {
    const [step, setStep] = useState<AppStep>(initialState?.step || AppStep.SONG_UPLOAD);
    const [audioFile, setAudioFile] = useState<File | null>(null);
    const [audioBase64, setAudioBase64] = useState<string | null>(initialState?.audioBase64 || null);
    const [audioMimeType, setAudioMimeType] = useState<string | null>(initialState?.audioMimeType || null);
    const [audioUrl, setAudioUrl] = useState<string | null>(resolvePlaybackUrl(initialState));
    const [audioDuration, setAudioDuration] = useState<number>(initialState?.audioDuration || 0);
    const [targetSceneCount, setTargetSceneCount] = useState<number>(initialState?.targetSceneCount || 10);
    const [characterImage, setCharacterImage] = useState<string | null>(initialState?.characterImage || null);
    const [musicMetadata, setMusicMetadata] = useState<MusicMetadata | null>(initialState?.musicMetadata || null);
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [isExtractingMeta, setIsExtractingMeta] = useState(false);
    const [analysis, setAnalysis] = useState<SongAnalysis | null>(initialState?.analysis || null);
    const [generatedImages, setGeneratedImages] = useState<string[]>(initialState?.generatedImages || []);
    const [isGeneratingVisuals, setIsGeneratingVisuals] = useState(false);
    const [progress, setProgress] = useState(0);
    const [progressLabel, setProgressLabel] = useState('');
    const [regeneratingIndex, setRegeneratingIndex] = useState<number | null>(null);
    const [error, setError] = useState<string | null>(null);
    const blobUrlRef = useRef<string | null>(null);

    useEffect(() => {
        return () => {
            if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        };
    }, []);

    const handleFileUpload = async (file: File) => {
        setError(null);
        setAudioFile(file);
        setIsExtractingMeta(true);

        if (blobUrlRef.current) URL.revokeObjectURL(blobUrlRef.current);
        const url = URL.createObjectURL(file);
        blobUrlRef.current = url;
        setAudioUrl(url);

        try {
            const { base64, mimeType } = await processCompatibleBase64(file);
            setAudioBase64(base64);
            setAudioMimeType(mimeType || file.type || 'audio/mpeg');
        } catch (err) {
            console.warn('Failed to encode audio', err);
            setError('Could not read this audio file. Try MP3 or M4A.');
            setIsExtractingMeta(false);
            return;
        }

        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
            setAudioDuration(audio.duration);
            setTargetSceneCount(Math.min(15, Math.max(5, Math.floor(audio.duration / 8))));
        };

        try {
            const arrayBuffer = await file.arrayBuffer();
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
            const metadata = extractMusicMetadata(decoded);
            setMusicMetadata(metadata);
        } catch (err) {
            console.warn('Failed to extract music metadata', err);
            setMusicMetadata(null);
        } finally {
            setIsExtractingMeta(false);
        }
    };

    const handleCharacterUpload = async (file: File) => {
        const { base64 } = await processCompatibleBase64(file);
        setCharacterImage(base64);
    };

    const buildPersistedState = (nextStep: AppStep, images = generatedImages): SongToVideoState => ({
        audioUrl: audioBase64 && audioMimeType
            ? `data:${audioMimeType};base64,${audioBase64}`
            : audioUrl,
        audioBase64,
        audioMimeType,
        audioDuration,
        targetSceneCount,
        characterImage,
        musicMetadata,
        analysis,
        generatedImages: images,
        step: nextStep,
    });

    const analyzeSong = async () => {
        if (!audioBase64) {
            setError('Upload a song first.');
            return;
        }
        setError(null);
        setIsAnalyzing(true);
        setStep(AppStep.SONG_ANALYSIS);
        try {
            const result = await analyzeSongCulturalContext(
                audioBase64,
                audioDuration,
                targetSceneCount,
                musicMetadata || undefined,
                audioMimeType || undefined
            );
            setAnalysis(result);
        } catch (err) {
            console.error('Analysis failed', err);
            setError(err instanceof Error ? err.message : 'Song analysis failed. Please try again.');
            setStep(AppStep.SONG_UPLOAD);
        } finally {
            setIsAnalyzing(false);
        }
    };

    const updateSegment = (index: number, patch: Partial<SongAnalysis['segments'][number]>) => {
        if (!analysis) return;
        const segments = analysis.segments.map((segment, i) => (i === index ? { ...segment, ...patch } : segment));
        setAnalysis({ ...analysis, segments });
    };

    const generateVisuals = useCallback(async () => {
        if (!analysis) return;
        setError(null);
        setIsGeneratingVisuals(true);
        setProgress(0);
        setProgressLabel('Starting…');
        setStep(AppStep.SONG_VISUAL_GENERATION);

        const totalSegments = analysis.segments.length;
        const images: string[] = new Array(totalSegments).fill('');
        const styleBible = analysis.suggestedVisuals || [];
        const continuityAnchor = characterImage || undefined;

        try {
            // Scene 0 first — establishes character look
            setProgressLabel(`Scene 1 of ${totalSegments}`);
            const first = await generateSongVisuals(
                analysis.culturalContext,
                analysis.segments[0].visualPrompt,
                analysis.characterDescription,
                continuityAnchor,
                styleBible
            );
            images[0] = first;
            setGeneratedImages([...images]);
            setProgress((1 / totalSegments) * 100);

            const sharedRef = characterImage || first;

            for (let start = 1; start < totalSegments; start += IMAGE_GEN_CONCURRENCY) {
                const batchIndexes = Array.from(
                    { length: Math.min(IMAGE_GEN_CONCURRENCY, totalSegments - start) },
                    (_, offset) => start + offset
                );
                setProgressLabel(
                    batchIndexes.length === 1
                        ? `Scene ${batchIndexes[0] + 1} of ${totalSegments}`
                        : `Scenes ${batchIndexes[0] + 1}–${batchIndexes[batchIndexes.length - 1] + 1} of ${totalSegments}`
                );

                const batchResults = await Promise.all(
                    batchIndexes.map(async (index) => {
                        const base64Image = await generateSongVisuals(
                            analysis.culturalContext,
                            analysis.segments[index].visualPrompt,
                            analysis.characterDescription,
                            sharedRef,
                            styleBible
                        );
                        return { index, base64Image };
                    })
                );

                for (const { index, base64Image } of batchResults) {
                    images[index] = base64Image;
                }
                setGeneratedImages([...images]);
                const done = images.filter(Boolean).length;
                setProgress((done / totalSegments) * 100);
            }

            setIsGeneratingVisuals(false);
            setProgressLabel('');
            setStep(AppStep.SONG_VIDEO_ASSEMBLY);
        } catch (err) {
            console.error('Visual generation failed', err);
            setError(err instanceof Error ? err.message : 'Visual generation failed. You can retry remaining scenes.');
            setGeneratedImages([...images]);
            setIsGeneratingVisuals(false);
            setProgressLabel('');
        }
    }, [analysis, characterImage]);

    const handleRegenerateScene = async (index: number) => {
        if (!analysis) return;
        setError(null);
        setRegeneratingIndex(index);
        try {
            const segment = analysis.segments[index];
            const previousImage = index > 0
                ? (generatedImages[index - 1] || characterImage || undefined)
                : (characterImage || undefined);
            const newImage = await generateSongVisuals(
                analysis.culturalContext,
                segment.visualPrompt,
                analysis.characterDescription,
                previousImage,
                analysis.suggestedVisuals
            );
            const newImages = [...generatedImages];
            newImages[index] = newImage;
            setGeneratedImages(newImages);
        } catch (err) {
            console.error('Regeneration failed', err);
            setError(err instanceof Error ? err.message : 'Regeneration failed.');
        } finally {
            setRegeneratingIndex(null);
        }
    };

    const handleReplaceScene = async (index: number, file: File) => {
        const { base64 } = await processCompatibleBase64(file);
        const newImages = [...generatedImages];
        newImages[index] = base64;
        setGeneratedImages(newImages);
    };

    const canStartAnalysis = Boolean(audioBase64) && !isExtractingMeta && !isAnalyzing;

    const steps = [
        { id: AppStep.SONG_UPLOAD, label: 'Upload' },
        { id: AppStep.SONG_ANALYSIS, label: 'Analysis' },
        { id: AppStep.SONG_VISUAL_GENERATION, label: 'Visuals' },
        { id: AppStep.SONG_VIDEO_ASSEMBLY, label: 'Preview' },
    ];
    const activeStepIndex = Math.max(0, steps.findIndex((s) => s.id === step));

    return (
        <div className="min-h-screen bg-[#05070F] text-white p-6 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-full overflow-hidden pointer-events-none">
                <div className="absolute top-[-10%] right-[-5%] w-[500px] h-[500px] rounded-full bg-insta-purple/20 blur-[120px]"></div>
                <div className="absolute bottom-[-10%] left-[-10%] w-[600px] h-[600px] rounded-full bg-insta-mid/10 blur-[100px]"></div>
            </div>

            <div className="flex items-center justify-between mb-8 relative z-10">
                <button onClick={onBack} className="flex items-center gap-2 text-white/60 hover:text-white transition group">
                    <span className="group-hover:-translate-x-1 transition-transform">←</span> Back
                </button>
                <h1 className="text-2xl font-black tracking-tight">Song to Video Studio</h1>
                <div className="w-20" />
            </div>

            <div className="max-w-3xl mx-auto mb-10 relative z-10">
                <div className="flex items-center gap-2">
                    {steps.map((s, index) => (
                        <React.Fragment key={s.id}>
                            <div className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs font-semibold border ${
                                index === activeStepIndex
                                    ? 'bg-white text-black border-white'
                                    : index < activeStepIndex
                                        ? 'bg-insta-mid/20 text-white border-insta-mid/40'
                                        : 'bg-white/5 text-white/40 border-white/10'
                            }`}>
                                <span>{index + 1}</span>
                                <span className="hidden sm:inline">{s.label}</span>
                            </div>
                            {index < steps.length - 1 && <div className="flex-1 h-px bg-white/10" />}
                        </React.Fragment>
                    ))}
                </div>
            </div>

            {error && (
                <div className="max-w-4xl mx-auto mb-6 relative z-10 rounded-2xl border border-red-500/40 bg-red-500/10 px-4 py-3 flex items-start justify-between gap-4">
                    <p className="text-sm text-red-100">{error}</p>
                    <button onClick={() => setError(null)} className="text-red-200/80 hover:text-white text-sm shrink-0">Dismiss</button>
                </div>
            )}

            <div className="max-w-4xl mx-auto">
                {step === AppStep.SONG_UPLOAD && (
                    <div className="max-w-xl mx-auto space-y-8 relative z-10">
                        {!audioBase64 ? (
                            <div className="group relative">
                                <div className="absolute -inset-0.5 bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple rounded-[32px] opacity-75 group-hover:opacity-100 transition blur duration-500"></div>
                                <div
                                    className="relative bg-[#0A0A0A] border border-white/10 rounded-[30px] p-16 text-center cursor-pointer overflow-hidden"
                                    onClick={() => document.getElementById('song-upload')?.click()}
                                >
                                    <div className="relative z-10 space-y-6">
                                        <div className="w-24 h-24 mx-auto bg-gradient-to-br from-insta-purple/20 to-insta-mid/10 rounded-full flex items-center justify-center border border-white/10 group-hover:scale-110 transition duration-500">
                                            <span className="text-4xl font-black text-white/80">♪</span>
                                        </div>
                                        <div>
                                            <h2 className="text-3xl font-bold mb-3 text-white">Upload your Song</h2>
                                            <p className="text-white/50 text-lg">MP3, WAV, or M4A supported</p>
                                        </div>
                                        <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white/5 border border-white/10 text-sm font-medium text-white/80 group-hover:bg-white/10 transition">
                                            Select File
                                        </div>
                                    </div>
                                    <input
                                        type="file"
                                        id="song-upload"
                                        className="hidden"
                                        accept="audio/*"
                                        onChange={(e) => e.target.files?.[0] && handleFileUpload(e.target.files[0])}
                                    />
                                </div>
                            </div>
                        ) : (
                            <div className="space-y-6 animate-fade-in">
                                <div className="bg-white/5 backdrop-blur-xl border border-white/10 rounded-2xl p-6 flex items-center gap-6 relative overflow-hidden">
                                    <div className="w-16 h-16 bg-gradient-to-br from-insta-purple to-insta-mid rounded-xl flex items-center justify-center shadow-lg relative z-10 shrink-0">
                                        <span className="text-2xl font-black">♪</span>
                                    </div>
                                    <div className="flex-1 relative z-10 min-w-0">
                                        <h3 className="text-xl font-bold text-white mb-1 truncate">
                                            {audioFile?.name || 'Saved song'}
                                        </h3>
                                        <p className="text-sm text-white/60">
                                            {audioDuration > 0 ? `${audioDuration.toFixed(1)}s` : '…'}
                                            {audioMimeType ? ` · ${audioMimeType}` : ''}
                                            {isExtractingMeta ? ' · Reading rhythm…' : ' · Ready'}
                                        </p>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setAudioFile(null);
                                            setAudioBase64(null);
                                            setAudioMimeType(null);
                                            setAudioUrl(null);
                                            setMusicMetadata(null);
                                            if (blobUrlRef.current) {
                                                URL.revokeObjectURL(blobUrlRef.current);
                                                blobUrlRef.current = null;
                                            }
                                        }}
                                        className="p-2 hover:bg-white/10 rounded-full transition relative z-10"
                                    >
                                        ✕
                                    </button>
                                </div>

                                <div className="bg-[#0F0F0F]/80 backdrop-blur-xl border border-white/10 rounded-3xl p-8 space-y-8">
                                    <h3 className="font-bold text-xl">Configuration</h3>

                                    <div className="space-y-4">
                                        <div className="flex justify-between items-center">
                                            <label className="text-sm font-medium text-white/80">Number of Scenes</label>
                                            <span className="px-3 py-1 rounded-full bg-white/10 text-xs font-bold text-white">{targetSceneCount} Scenes</span>
                                        </div>
                                        <input
                                            type="range"
                                            min="3"
                                            max="15"
                                            value={targetSceneCount}
                                            onChange={(e) => setTargetSceneCount(Number(e.target.value))}
                                            className="w-full h-2 bg-white/10 rounded-lg appearance-none cursor-pointer accent-insta-mid"
                                        />
                                        <div className="flex justify-between text-[10px] text-white/40 uppercase tracking-wider font-medium">
                                            <span>3 (Short)</span>
                                            <span>15 (Long)</span>
                                        </div>
                                    </div>

                                    <div className="space-y-4">
                                        <label className="block text-sm font-medium text-white/80">
                                            Character Reference <span className="text-white/40 font-normal">(Optional)</span>
                                        </label>
                                        <div className="flex items-start gap-4 p-4 bg-white/5 rounded-xl border border-white/5">
                                            {characterImage ? (
                                                <div className="relative w-20 h-20 rounded-xl overflow-hidden border-2 border-insta-mid shadow-lg shrink-0 group">
                                                    <img src={`data:image/jpeg;base64,${characterImage}`} className="w-full h-full object-cover" alt="Character" />
                                                    <button
                                                        onClick={() => setCharacterImage(null)}
                                                        className="absolute inset-0 bg-black/60 flex items-center justify-center opacity-0 group-hover:opacity-100 transition"
                                                    >
                                                        <span className="text-xs font-bold text-white">Remove</span>
                                                    </button>
                                                </div>
                                            ) : (
                                                <button
                                                    onClick={() => document.getElementById('char-upload')?.click()}
                                                    className="w-20 h-20 rounded-xl border border-dashed border-white/30 flex flex-col items-center justify-center hover:bg-white/5 hover:border-insta-mid hover:text-insta-mid transition shrink-0"
                                                >
                                                    <span className="text-2xl">+</span>
                                                </button>
                                            )}
                                            <p className="text-xs text-white/60 leading-relaxed flex-1">
                                                Upload a photo of a person or character. The AI keeps this identity consistent across scenes.
                                            </p>
                                            <input
                                                type="file"
                                                id="char-upload"
                                                className="hidden"
                                                accept="image/*"
                                                onChange={(e) => e.target.files?.[0] && handleCharacterUpload(e.target.files[0])}
                                            />
                                        </div>
                                    </div>

                                    {musicMetadata && (
                                        <div className="grid grid-cols-1 md:grid-cols-3 gap-3 text-sm">
                                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                                <p className="text-white/50 uppercase tracking-wider text-[11px] font-semibold mb-1">Tempo</p>
                                                <p className="text-2xl font-black text-white">{Math.round(musicMetadata.estimatedBpm)} BPM</p>
                                            </div>
                                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                                <p className="text-white/50 uppercase tracking-wider text-[11px] font-semibold mb-1">Peak Moments</p>
                                                <p className="text-white/80">{musicMetadata.peakMoments.map(t => `${t.toFixed(1)}s`).join(' · ') || 'Analyzing'}</p>
                                            </div>
                                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                                <p className="text-white/50 uppercase tracking-wider text-[11px] font-semibold mb-1">Loudness</p>
                                                <p className="text-white/80">RMS {musicMetadata.rms.toFixed(3)}</p>
                                            </div>
                                        </div>
                                    )}

                                    <button
                                        onClick={analyzeSong}
                                        disabled={!canStartAnalysis}
                                        className="w-full py-5 bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple text-white font-bold rounded-2xl hover:shadow-[0_0_40px_rgba(131,58,180,0.5)] hover:scale-[1.02] transition-all duration-300 text-lg disabled:opacity-40 disabled:hover:scale-100 disabled:cursor-not-allowed"
                                    >
                                        {isExtractingMeta ? 'Reading rhythm…' : 'Analyze Song'}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {step === AppStep.SONG_ANALYSIS && (
                    <div className="flex flex-col items-center justify-center py-8 relative z-10">
                        {isAnalyzing || !analysis ? (
                            <div className="space-y-8 text-center">
                                <div className="relative w-48 h-48 mx-auto">
                                    <div className="absolute inset-0 rounded-full bg-black border-4 border-[#1a1a1a] shadow-2xl animate-[spin_3s_linear_infinite] flex items-center justify-center overflow-hidden">
                                        <div className="absolute inset-0 bg-[repeating-radial-gradient(#333_0_1px,transparent_1px_4px)] opacity-20"></div>
                                        <div className="w-16 h-16 rounded-full bg-gradient-to-br from-insta-purple to-insta-mid flex items-center justify-center">
                                            <div className="w-2 h-2 rounded-full bg-black"></div>
                                        </div>
                                    </div>
                                </div>
                                <div>
                                    <h2 className="text-3xl font-black tracking-tight text-white">
                                        Analyzing with Gemini Pro…
                                    </h2>
                                    <p className="text-insta-mid font-mono mt-2 text-sm uppercase tracking-widest">
                                        Culture · lyrics · beat map
                                    </p>
                                </div>
                            </div>
                        ) : (
                            <div className="max-w-3xl w-full space-y-8 animate-[slideUp_0.5s_ease-out]">
                                <div className="text-center space-y-2">
                                    <div className="inline-block px-4 py-1 rounded-full bg-insta-purple/20 border border-insta-purple/50 text-insta-purple text-xs font-bold uppercase tracking-widest mb-4">
                                        Review before generating
                                    </div>
                                    <input
                                        className="w-full text-center text-4xl md:text-5xl font-black text-white bg-transparent border-b border-white/10 focus:border-insta-mid outline-none pb-2"
                                        value={analysis.culturalContext}
                                        onChange={(e) => setAnalysis({ ...analysis, culturalContext: e.target.value })}
                                    />
                                    <input
                                        className="w-full text-center text-xl text-white/60 bg-transparent border-b border-transparent focus:border-white/20 outline-none"
                                        value={analysis.mood}
                                        onChange={(e) => setAnalysis({ ...analysis, mood: e.target.value })}
                                    />
                                </div>

                                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                    <div className="bg-white/5 border border-white/10 p-5 rounded-3xl space-y-2">
                                        <h3 className="text-sm font-bold uppercase text-white/40">Aesthetic</h3>
                                        <textarea
                                            className="w-full bg-transparent text-white/90 leading-relaxed outline-none resize-none min-h-[80px]"
                                            value={analysis.imagery}
                                            onChange={(e) => setAnalysis({ ...analysis, imagery: e.target.value })}
                                        />
                                    </div>
                                    <div className="bg-white/5 border border-white/10 p-5 rounded-3xl space-y-2">
                                        <h3 className="text-sm font-bold uppercase text-white/40">Main Character</h3>
                                        <textarea
                                            className="w-full bg-transparent text-white/90 leading-relaxed outline-none resize-none min-h-[80px]"
                                            value={analysis.characterDescription || ''}
                                            onChange={(e) => setAnalysis({ ...analysis, characterDescription: e.target.value })}
                                        />
                                    </div>
                                </div>

                                {analysis.suggestedVisuals?.length > 0 && (
                                    <div className="space-y-3">
                                        <h3 className="text-sm font-bold uppercase text-white/40">Look bible</h3>
                                        <div className="flex flex-wrap gap-2">
                                            {analysis.suggestedVisuals.map((theme, index) => (
                                                <span key={`${theme}-${index}`} className="px-3 py-1.5 rounded-full bg-white/5 border border-white/10 text-sm text-white/80">
                                                    {theme}
                                                </span>
                                            ))}
                                        </div>
                                    </div>
                                )}

                                {(analysis.lyricHooks?.length || analysis.structureNotes) && (
                                    <div className="bg-white/5 border border-white/10 rounded-3xl p-5 space-y-3">
                                        {analysis.structureNotes && (
                                            <div>
                                                <h3 className="text-sm font-bold uppercase text-white/40 mb-1">Structure</h3>
                                                <p className="text-white/80 text-sm">{analysis.structureNotes}</p>
                                            </div>
                                        )}
                                        {!!analysis.lyricHooks?.length && (
                                            <div>
                                                <h3 className="text-sm font-bold uppercase text-white/40 mb-2">Lyric hooks</h3>
                                                <div className="flex flex-wrap gap-2">
                                                    {analysis.lyricHooks.map((hook, index) => (
                                                        <span key={`${hook}-${index}`} className="px-3 py-1 rounded-full bg-insta-mid/15 border border-insta-mid/30 text-sm italic text-white/90">
                                                            “{hook}”
                                                        </span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                )}

                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <h3 className="text-sm font-bold uppercase text-white/40">
                                            Scenes ({analysis.segments.length})
                                        </h3>
                                        <button
                                            onClick={() => {
                                                setAnalysis(null);
                                                setStep(AppStep.SONG_UPLOAD);
                                            }}
                                            className="text-xs text-white/50 hover:text-white"
                                        >
                                            Re-analyze
                                        </button>
                                    </div>
                                    <div className="space-y-3 max-h-[360px] overflow-y-auto pr-1">
                                        {analysis.segments.map((seg, idx) => (
                                            <div key={idx} className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-2">
                                                <div className="flex items-center justify-between gap-3">
                                                    <input
                                                        className="bg-transparent font-semibold text-white outline-none flex-1"
                                                        value={seg.description}
                                                        onChange={(e) => updateSegment(idx, { description: e.target.value })}
                                                    />
                                                    <span className="text-[11px] font-mono text-white/40 shrink-0">
                                                        {seg.startTime.toFixed(1)}s – {seg.endTime.toFixed(1)}s
                                                    </span>
                                                </div>
                                                <textarea
                                                    className="w-full bg-black/20 border border-white/5 rounded-xl p-3 text-sm text-white/80 outline-none focus:border-insta-mid/40 resize-none min-h-[64px]"
                                                    value={seg.visualPrompt}
                                                    onChange={(e) => updateSegment(idx, { visualPrompt: e.target.value })}
                                                />
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                <div className="flex flex-col sm:flex-row gap-3">
                                    <button
                                        onClick={() => setStep(AppStep.SONG_UPLOAD)}
                                        className="flex-1 py-4 rounded-2xl border border-white/15 text-white/80 hover:bg-white/5 transition font-semibold"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={generateVisuals}
                                        className="flex-[2] py-4 rounded-2xl bg-white text-black font-bold hover:bg-gray-200 transition"
                                    >
                                        Generate {analysis.segments.length} Visuals
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}

                {step === AppStep.SONG_VISUAL_GENERATION && (
                    <div className="space-y-12 relative z-10">
                        <div className="text-center space-y-6">
                            <h2 className="text-4xl font-black text-white">
                                {isGeneratingVisuals ? 'Generating visuals' : 'Visuals ready'}
                            </h2>

                            <div className="max-w-md mx-auto relative">
                                <div className="h-4 bg-white/5 rounded-full overflow-hidden border border-white/10">
                                    <div
                                        className="h-full bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple transition-all duration-500 relative"
                                        style={{ width: `${progress}%` }}
                                    >
                                        <div className="absolute inset-0 bg-[linear-gradient(45deg,transparent_25%,rgba(255,255,255,0.3)_50%,transparent_75%)] bg-[length:20px_20px] animate-[shimmer_1s_linear_infinite]"></div>
                                    </div>
                                </div>
                                <div className="flex justify-between mt-2 font-mono text-xs text-white/40 uppercase tracking-widest">
                                    <span>{progressLabel || 'Progress'}</span>
                                    <span>{Math.round(progress)}%</span>
                                </div>
                            </div>

                            {!isGeneratingVisuals && error && (
                                <button
                                    onClick={generateVisuals}
                                    className="px-5 py-2 rounded-full bg-white text-black text-sm font-bold"
                                >
                                    Retry generation
                                </button>
                            )}
                        </div>

                        <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                            {analysis?.segments.map((seg, idx) => (
                                <div key={idx} className="aspect-[9/16] bg-gray-800 rounded-xl overflow-hidden relative group">
                                    {generatedImages[idx] ? (
                                        <>
                                            <img
                                                src={`data:image/jpeg;base64,${generatedImages[idx]}`}
                                                className={`w-full h-full object-cover ${regeneratingIndex === idx ? 'opacity-50 blur-sm' : ''}`}
                                                alt={seg.description}
                                            />
                                            {regeneratingIndex === idx && (
                                                <div className="absolute inset-0 flex items-center justify-center">
                                                    <div className="animate-spin w-8 h-8 border-2 border-white/30 border-t-white rounded-full" />
                                                </div>
                                            )}
                                            <div className="absolute inset-0 bg-black/60 opacity-0 group-hover:opacity-100 transition flex flex-col items-center justify-center gap-2">
                                                <button
                                                    onClick={() => handleRegenerateScene(idx)}
                                                    className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full text-xs font-semibold backdrop-blur border border-white/10"
                                                >
                                                    Regenerate
                                                </button>
                                                <label className="px-3 py-1 bg-white/10 hover:bg-white/20 rounded-full text-xs font-semibold backdrop-blur border border-white/10 cursor-pointer">
                                                    Replace
                                                    <input type="file" hidden accept="image/*" onChange={(e) => e.target.files?.[0] && handleReplaceScene(idx, e.target.files[0])} />
                                                </label>
                                            </div>
                                        </>
                                    ) : (
                                        <div className="w-full h-full flex items-center justify-center text-white/20">
                                            <span className="animate-pulse text-sm">Waiting…</span>
                                        </div>
                                    )}
                                    <div className="absolute bottom-0 left-0 right-0 p-3 bg-gradient-to-t from-black/80 to-transparent pointer-events-none">
                                        <p className="text-xs font-bold text-white">{seg.description}</p>
                                        <p className="text-[10px] text-white/60">{seg.startTime}s - {seg.endTime}s</p>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {!isGeneratingVisuals && generatedImages.filter(Boolean).length === analysis?.segments.length && (
                            <div className="text-center">
                                <button
                                    onClick={() => setStep(AppStep.SONG_VIDEO_ASSEMBLY)}
                                    className="px-8 py-3 bg-white text-black rounded-full font-bold"
                                >
                                    Continue to Preview
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {step === AppStep.SONG_VIDEO_ASSEMBLY && (
                    <div className="text-center space-y-8 relative z-10">
                        <div className="space-y-2">
                            <h2 className="text-3xl font-bold">Preview & open editor</h2>
                            <p className="text-white/50 text-sm">
                                {analysis?.segments.length || 0} scenes · {audioDuration.toFixed(1)}s · synced to your song
                            </p>
                        </div>
                        <div className="aspect-[9/16] max-w-sm mx-auto bg-gray-900 rounded-2xl overflow-hidden relative shadow-2xl border border-white/10">
                            <PreviewPlayer
                                images={generatedImages}
                                segments={analysis?.segments || []}
                                audioUrl={audioUrl}
                            />
                        </div>

                        <div className="flex flex-col sm:flex-row gap-3 justify-center">
                            <button
                                onClick={() => setStep(AppStep.SONG_VISUAL_GENERATION)}
                                className="px-6 py-3 rounded-full border border-white/15 text-white/80 hover:bg-white/5 font-semibold"
                            >
                                Back to visuals
                            </button>
                            <button
                                onClick={() => {
                                    const mediaItems: UploadedMedia[] = generatedImages.map((b64, idx) => ({
                                        file: new File([], `scene_${idx}.jpg`),
                                        previewUrl: `data:image/jpeg;base64,${b64}`,
                                        src: `data:image/jpeg;base64,${b64}`,
                                        id: `song-scene-${idx}`,
                                        type: 'image',
                                        mimeType: 'image/jpeg',
                                        base64: b64,
                                        duration: (analysis?.segments[idx].endTime || 0) - (analysis?.segments[idx].startTime || 0)
                                    }));
                                    onComplete(mediaItems, buildPersistedState(AppStep.SONG_VIDEO_ASSEMBLY, generatedImages));
                                }}
                                disabled={!generatedImages.length || generatedImages.some((img) => !img)}
                                className="bg-white text-black px-8 py-3 rounded-full font-bold text-lg hover:bg-gray-200 transition disabled:opacity-40"
                            >
                                Open in Editor
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default SongToVideoStudio;

const PreviewPlayer: React.FC<{ images: string[], segments: SongAnalysis['segments'], audioUrl: string | null }> = ({ images, segments, audioUrl }) => {
    const [isPlaying, setIsPlaying] = useState(false);
    const [currentImageIndex, setCurrentImageIndex] = useState(0);
    const audioRef = useRef<HTMLAudioElement | null>(null);
    const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

    useEffect(() => {
        if (audioUrl) {
            audioRef.current = new Audio(audioUrl);
            audioRef.current.onended = () => setIsPlaying(false);
        }
        return () => {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            if (intervalRef.current) clearInterval(intervalRef.current);
        };
    }, [audioUrl]);

    useEffect(() => {
        if (isPlaying) {
            intervalRef.current = setInterval(() => {
                if (!audioRef.current) return;
                const currentTime = audioRef.current.currentTime;

                let index = segments.findIndex(s => currentTime >= s.startTime && currentTime < s.endTime);

                if (index === -1 && segments.length > 0) {
                    if (currentTime >= segments[segments.length - 1].endTime) {
                        index = segments.length - 1;
                    } else if (currentTime < segments[0].startTime) {
                        index = 0;
                    }
                }

                if (index !== -1 && index !== currentImageIndex) {
                    setCurrentImageIndex(index);
                }
            }, 100);
        } else if (intervalRef.current) {
            clearInterval(intervalRef.current);
        }
        return () => { if (intervalRef.current) clearInterval(intervalRef.current); };
    }, [isPlaying, segments, currentImageIndex]);

    const togglePlay = () => {
        if (!audioRef.current) return;
        if (isPlaying) {
            audioRef.current.pause();
        } else {
            audioRef.current.play();
        }
        setIsPlaying(!isPlaying);
    };

    return (
        <div className="relative w-full h-full group cursor-pointer" onClick={togglePlay}>
            {images[currentImageIndex] && (
                <img
                    src={`data:image/jpeg;base64,${images[currentImageIndex]}`}
                    className="w-full h-full object-cover transition-opacity duration-500"
                    alt={segments[currentImageIndex]?.description || 'Scene'}
                />
            )}
            <div className={`absolute inset-0 flex items-center justify-center bg-black/30 transition-opacity ${isPlaying ? 'opacity-0 group-hover:opacity-100' : 'opacity-100'}`}>
                <div className="w-16 h-16 bg-white/90 rounded-full flex items-center justify-center text-black text-2xl pl-1 shadow-lg backdrop-blur">
                    {isPlaying ? '⏸' : '▶'}
                </div>
            </div>
            <div className="absolute bottom-4 left-4 right-4 text-center">
                <p className="text-white text-xs font-bold drop-shadow-md bg-black/50 px-2 py-1 rounded-full inline-block">
                    {segments[currentImageIndex]?.description}
                </p>
            </div>
        </div>
    );
};
