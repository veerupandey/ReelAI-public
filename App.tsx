import React, { useState, useEffect, useRef, useMemo, useCallback } from 'react';
import { AppStep, UploadedMedia, ReelScript, VoiceName, ScriptStyle, VisualSettings, VideoSegment, CreationMode, ReelPlan, ScenePlan, BrandKit, GeneratedMusicTrack, VisualAsset, SubtitleSettings, AudioMixSettings, FilterPreset, TransitionEffect, MusicAnalysis, ExportPreset, ViralTopicFinderResult, ViralTopicIdea, VoiceOption, SceneDraft, ScenePacingRole, BrandAssetCatalogEntry, ApprovedStoryboardSceneMetadata, ImageGenerationRequest, SceneReferenceBinding, DEFAULT_SUBTITLE_SETTINGS, DEFAULT_AUDIO_MIX_SETTINGS } from './types';
import MediaInput from './components/MediaInput';
import ReelPreview from './components/ReelPreview';
import { KeyframeTimeline } from './components/KeyframeTimeline';
import { recommendFullVisualDirection, applyVisualDirection, computeViralScore } from './services/motionDirectorService';
import VideoExtensionStudio from './components/VideoExtensionStudio';
import SongToVideoStudio, { SongToVideoState } from './components/SongToVideoStudio';
import VoiceRecorder from './components/VoiceRecorder';
import UsageStats from './components/UsageStats';
import ErrorBoundary from './components/ErrorBoundary';
import ProjectsPanel from './components/ProjectsPanel';
import BrandVideoCreator from './components/BrandVideoCreator';
import AgentConsole from './components/AgentConsole';
import GeneralAgentConsole from './components/GeneralAgentConsole';
import AgentHub from './components/AgentHub';
import AIImageStudioScreen from './components/AIImageStudio/AIImageStudioScreen';
import PlannerModelControls from './components/PlannerModelControls';
import { getStoredPreferredPlannerModel } from './services/llm/apiKeys';
import { DEFAULT_PLANNER_MODEL, type PlannerModelId } from './services/llm/types';
import type { AssetProvenanceStep, CampaignBlueprint, SceneRoute } from './types/brand';
import { useAuth } from './contexts/AuthContext';
import { analyzeMediaAndCreateScript, generateVoiceover, composeMusic, analyzeVideoStructure, analyzeMediaContext, rewriteScriptSegment, generateReelPlan, generateImageAsset, analyzeBrandAesthetics, catalogBrandAssets, agentResearch, agentTopicRefiner, analyzeMusicMood, suggestCaptionStyle, CaptionStyleSuggestion, generateSingleScenePlan, generateSingleScriptSegment, agentViralTopicFinder, analyzeImagePresentation, suggestSceneImageEdit, hasConfiguredGeminiApiKey, TopicRefinerContext, ReelPlanContext, normalizePlanDurations, fitSceneScriptsToMeasuredDurations } from './services/geminiService';
import { decodeAudioData, fileToBase64, blobToAudioBuffer, trimAudioSilence, concatenateAudioBuffers, processCompatibleBase64, extractMusicMetadata } from './utils/audioHelper';
import { synthesizeComposition } from './utils/musicSynth';
import { usageTracker } from './utils/usageTracker';
import { saveReelHistoryEntry, type ReelHistoryEntry, fetchUserSessions, type UserSessionRecord, requestSessionLogout, saveProjectSession } from './services/userDataService';
import { 
    appendSceneImageVariant, 
    applySceneDurationEdit, 
    applySceneTextEdit, 
    serializeSceneDraftsForPersistence,
    serializeUploadedMediaForPersistence,
    buildSceneImageGenerationRequest, 
    clampSceneDuration, 
    createSceneDraftFromPlanScene, 
    createSceneDraftsFromMediaAndScript, 
    deriveMediaFromSceneDrafts, 
    deriveScriptFromSceneDrafts, 
    deriveSlideDurationsFromSceneDrafts, 
    getSceneDraftId, 
    getSceneVoiceCacheKey,
    getSceneSpokenText,
    sumSceneDurations,
    equalSplitDurations,
    rolePresetDuration,
    resolveVoiceTimelineTargets,
    assessMeasuredNarrationFeasibility,
    reconcileTimelineToMeasuredVoice,
    rippleUnlockedDurationsToTarget,
    buildPacingScenesViewModel,
    getMediaDisplayUrl,
    mergeScriptIntoSceneDrafts, 
    promoteSceneImageVariant, 
    reconcileSceneDraftsWithMedia,
    syncStoryboardMetadataAcrossDraftsAndMedia,
    getEffectiveStoryboardRoute,
    getRouteActionSpec,
    getSceneVisualPrompt,
    isLikelyVisualPromptText,
    isBrokenRewriteOutput,
    hasInlineImageReference,
    cleanScriptText,
    type SceneRouteActionId,
} from './utils/sceneDrafts';
import {
    buildRouteReferenceAssembly,
    getSceneReferenceInputFromMedia,
    normalizeSceneReferenceBindings,
} from './utils/sceneReferenceBuilder';
import {
  mapCampaignBlueprintToAgentLaunch,
  mapCampaignBlueprintToStudioHandoff,
  prepareAgentLaunchForSessionStorage,
} from './services/brandVideoHandoff';
import { prepareHubAgentLaunchForSessionStorage, stashPendingHubLaunch } from './services/agentLaunchStore';
import { reviewGeneratedSceneOutputs } from './services/reviewService';
import { ScriptStudioProvider } from './components/ScriptStudio/ScriptStudioContext';
import ScriptStudio from './components/ScriptStudio/ScriptStudio';
import SceneReferencePickerModal, { type SceneReferencePickerOption } from './components/ScriptStudio/SceneReferencePickerModal';
import { getScriptStudioRouteLabel, getScriptStudioRouteTone, getScriptStudioSourceModeLabel } from './components/ScriptStudio/scriptStudioViewUtils';
import { mapPool } from './utils/kvCache';

const GEMINI_VOICE_OPTIONS: VoiceOption[] = [
    // Core
    { provider: 'gemini', id: VoiceName.Puck, label: 'Puck', locale: 'en-US', gender: 'Male', description: 'Upbeat & playful' },
    { provider: 'gemini', id: VoiceName.Charon, label: 'Charon', locale: 'en-US', gender: 'Male', description: 'Informative & deep' },
    { provider: 'gemini', id: VoiceName.Kore, label: 'Kore', locale: 'en-US', gender: 'Female', description: 'Firm & clear' },
    { provider: 'gemini', id: VoiceName.Fenrir, label: 'Fenrir', locale: 'en-US', gender: 'Male', description: 'Excitable & bold' },
    { provider: 'gemini', id: VoiceName.Zephyr, label: 'Zephyr', locale: 'en-US', gender: 'Female', description: 'Bright & airy' },
    { provider: 'gemini', id: VoiceName.Aoede, label: 'Aoede', locale: 'en-US', gender: 'Female', description: 'Breezy & confident' },
    // New Gemini 3.1 Flash TTS voices
    { provider: 'gemini', id: VoiceName.Leda, label: 'Leda', locale: 'en-US', gender: 'Female', description: 'Youthful energy' },
    { provider: 'gemini', id: VoiceName.Orus, label: 'Orus', locale: 'en-US', gender: 'Male', description: 'Firm narrator' },
    { provider: 'gemini', id: VoiceName.Sulafat, label: 'Sulafat', locale: 'en-US', gender: 'Female', description: 'Warm storyteller' },
    { provider: 'gemini', id: VoiceName.Achird, label: 'Achird', locale: 'en-US', gender: 'Male', description: 'Friendly host' },
    { provider: 'gemini', id: VoiceName.Sadaltager, label: 'Sadaltager', locale: 'en-US', gender: 'Male', description: 'Knowledgeable guide' },
    { provider: 'gemini', id: VoiceName.Enceladus, label: 'Enceladus', locale: 'en-US', gender: 'Male', description: 'Breathy ASMR' },
    { provider: 'gemini', id: VoiceName.Gacrux, label: 'Gacrux', locale: 'en-US', gender: 'Female', description: 'Mature & grounded' },
    { provider: 'gemini', id: VoiceName.Vindemiatrix, label: 'Vindemiatrix', locale: 'en-US', gender: 'Female', description: 'Gentle soft-sell' },
    { provider: 'gemini', id: VoiceName.Algenib, label: 'Algenib', locale: 'en-US', gender: 'Male', description: 'Gravelly character' },
    { provider: 'gemini', id: VoiceName.Laomedeia, label: 'Laomedeia', locale: 'en-US', gender: 'Female', description: 'Upbeat promo' },
    { provider: 'gemini', id: VoiceName.Callirrhoe, label: 'Callirrhoe', locale: 'en-US', gender: 'Female', description: 'Easy-going chat' },
    { provider: 'gemini', id: VoiceName.Autonoe, label: 'Autonoe', locale: 'en-US', gender: 'Female', description: 'Bright & crisp' },
    { provider: 'gemini', id: VoiceName.Iapetus, label: 'Iapetus', locale: 'en-US', gender: 'Male', description: 'Clear documentary' },
    { provider: 'gemini', id: VoiceName.Despina, label: 'Despina', locale: 'en-US', gender: 'Female', description: 'Smooth luxury' },
    { provider: 'gemini', id: VoiceName.Sadachbia, label: 'Sadachbia', locale: 'en-US', gender: 'Male', description: 'Lively hype' },
    { provider: 'gemini', id: VoiceName.Schedar, label: 'Schedar', locale: 'en-US', gender: 'Male', description: 'Even & steady' },
    // Regional style aliases (mapped to prebuilt voices)
    { provider: 'gemini', id: VoiceName.Rishi, label: 'Rishi', locale: 'en-IN', gender: 'Male', description: 'Warm Hinglish', accentHint: 'Deliver in natural Hinglish with light Desi cadence.' },
    { provider: 'gemini', id: VoiceName.Mira, label: 'Mira', locale: 'en-IN', gender: 'Female', description: 'Lively Hinglish', accentHint: 'Use upbeat Hinglish phrasing with Indian intonation.' },
    { provider: 'gemini', id: VoiceName.Hikaru, label: 'Hikaru', locale: 'ja-JP', gender: 'Male', description: 'Japanese narrator', accentHint: 'Speak fluent Japanese with a calm, confident male tone.' },
];

const GOOGLE_VOICE_OPTIONS: VoiceOption[] = [
    { provider: 'google', id: 'en-IN-Neural2-A', label: 'Google Asha', locale: 'en-IN', gender: 'Female', description: 'English (India) Neural2 A' },
    { provider: 'google', id: 'en-IN-Neural2-D', label: 'Google Diya', locale: 'en-IN', gender: 'Female', description: 'English (India) Neural2 D' },
    { provider: 'google', id: 'hi-IN-Neural2-A', label: 'Google Anaya', locale: 'hi-IN', gender: 'Female', description: 'Hindi (India) Neural2 A' },
    { provider: 'google', id: 'hi-IN-Neural2-D', label: 'Google Devika', locale: 'hi-IN', gender: 'Female', description: 'Hindi (India) Neural2 D' },
    { provider: 'google', id: 'pa-IN-Wavenet-A', label: 'Google Noor', locale: 'pa-IN', gender: 'Female', description: 'Punjabi (India) Wavenet A' },
    { provider: 'google', id: 'pa-IN-Wavenet-C', label: 'Google Simran', locale: 'pa-IN', gender: 'Female', description: 'Punjabi (India) Wavenet C' },
];

const GOOGLE_TTS_ENABLED = Boolean(import.meta.env.VITE_GOOGLE_TTS_ENABLED === 'true');
const AVAILABLE_VOICE_OPTIONS: VoiceOption[] = GOOGLE_TTS_ENABLED
    ? [...GEMINI_VOICE_OPTIONS, ...GOOGLE_VOICE_OPTIONS]
    : GEMINI_VOICE_OPTIONS;
const DEFAULT_VOICE_OPTION = GEMINI_VOICE_OPTIONS[0];
const voiceDetails = Object.fromEntries(
    AVAILABLE_VOICE_OPTIONS.map((voice) => [voice.id, {
        desc: voice.description || voice.label,
        gender: voice.gender,
        accentHint: voice.accentHint,
        provider: voice.provider,
        locale: voice.locale,
    }]),
) as Record<string, { desc: string; gender: 'Male' | 'Female'; accentHint?: string; provider: string; locale: string }>;

const shouldPreferExactBrandAssetScene = (
    scene: Pick<ScenePlan, 'visualDescription' | 'imagePrompt' | 'scriptGuidance' | 'brandAssetEditAction'>,
    catalogEntry?: BrandAssetCatalogEntry,
): boolean => {
    if (scene.brandAssetEditAction === 'use_as_is') return true;

    const sceneText = `${scene.visualDescription || ''} ${scene.imagePrompt || ''} ${scene.scriptGuidance || ''}`.toLowerCase();
    const shotType = catalogEntry?.shotType || 'unknown';

    const requiresTransform = /(woman|model|face|cheek|skin close|before|after|split screen|comparison|application|apply|applying|massage|hand applying|dropper on skin|serum dripping|pouring|floating|levitating|surreal|diagram|infographic|arrows|cutaway|cross[- ]section|inside the bottle|x-ray|macro texture on skin)/.test(sceneText);
    const isProductFocused = /(product|bottle|serum|packshot|hero shot|close[- ]?up|standing|counter|marble|shelf|table|botanicals|ingredients around|final shot|cta shot|detail shot|label shot)/.test(sceneText)
        || shotType === 'packshot'
        || shotType === 'detail';
    const isAbstractMetaphor = /(forest|jungle|waterfall|mountain|stone path|moss|woodland|landscape|creek|river|tree bark|leaf canopy|animal|gargoyle|statue)/.test(sceneText);

    return !requiresTransform && (isProductFocused || shotType !== 'unknown' || isAbstractMetaphor);
};

const scrollScenePanelIntoView = (ref: React.RefObject<HTMLDivElement | null>) => {
    ref.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
};

const buildVoiceSyncSignature = (
    drafts: SceneDraft[],
    voice: Pick<VoiceOption, 'provider' | 'id'> | { provider: string; id: string } | null,
): string => {
    const voiceKey = voice ? `${voice.provider}:${voice.id}` : 'no-voice';
    const sceneKey = drafts.map((draft, index) => [
        draft.id || index,
        (draft.voiceoverText || draft.onScreenText || '').trim(),
    ].join('::')).join('|');
    return `${voiceKey}__${sceneKey}`;
};

const isGeminiTtsQuotaError = (error: unknown): boolean => {
    const message = error instanceof Error ? error.message : String(error || '');
    return /quota exceeded|resource_exhausted|generate_requests_per_model_per_day|gemini-2\.5-flash-tts|retry in/i.test(message);
};

const getGeminiTtsQuotaMessage = (error: unknown): string => {
    const message = error instanceof Error ? error.message : String(error || '');
    const retryMatch = message.match(/retry in\s+([0-9a-zA-Z.\s]+)/i);
    const retryHint = retryMatch?.[1]?.trim();
    return retryHint
        ? `Voice generation is unavailable because the Gemini TTS daily quota is exhausted. Retry in about ${retryHint}.`
        : 'Voice generation is unavailable because the Gemini TTS daily quota is exhausted. Try again after the quota resets.';
};

const createExactBrandMedia = (
    sceneId: string,
    draft: SceneDraft,
    brandAsset: VisualAsset,
    brandAssetId: string | undefined,
    presentation?: Pick<BrandAssetCatalogEntry, 'framingMode' | 'framingFocusY' | 'presentationReason'>,
): UploadedMedia => {
    const duration = clampSceneDuration(draft.requestedDurationSec || draft.resolvedDurationSec);
    const previewUrl = brandAsset.previewUrl || toDataUrl(brandAsset.base64, brandAsset.mimeType);
    const storyboardMetadata = extractApprovedStoryboardMetadata(draft);
    return {
        id: sceneId,
        sceneId,
        file: brandAsset.file || new File([], `brand_asset_${brandAssetId || sceneId}.jpg`),
        previewUrl,
        thumbnailUrl: previewUrl,
        type: 'image',
        base64: brandAsset.base64,
        mimeType: brandAsset.mimeType,
        duration,
        extendedDuration: duration,
        description: draft.visualDescription,
        imagePrompt: draft.imagePrompt,
        assetOrigin: 'brand_asset',
        brandAssetId,
        sceneReferenceBindings: normalizeSceneReferenceBindings(draft.sceneReferenceBindings, draft),
        sourceAssetIds: brandAssetId ? [brandAssetId] : undefined,
        provenance: brandAssetId ? [{
            assetId: brandAssetId,
            role: 'product',
            preserve: ['product_identity', 'label', 'composition'],
        }] : undefined,
        aiFramingMode: presentation?.framingMode,
        aiFramingFocusY: presentation?.framingFocusY,
        aiPresentationReason: presentation?.presentationReason,
        ...storyboardMetadata,
    };
};

const extractApprovedStoryboardMetadata = (
    scene?: Partial<ScenePlan> | null,
): ApprovedStoryboardSceneMetadata => ({
    productId: scene?.productId,
    productTitle: scene?.productTitle,
    productUrl: scene?.productUrl,
    storyboardRoute: scene?.storyboardRoute,
    storyboardRouteOverride: scene?.storyboardRouteOverride,
    storyboardRouteReason: scene?.storyboardRouteReason,
    storyboardSourceMode: scene?.storyboardSourceMode,
    storyboardVisualTask: scene?.storyboardVisualTask,
    storyboardVisualTaskReason: scene?.storyboardVisualTaskReason,
    storyboardSuggestedPosition: scene?.storyboardSuggestedPosition,
    storyboardBaseAssetId: scene?.storyboardBaseAssetId,
    storyboardBaseAssetDescription: scene?.storyboardBaseAssetDescription,
    storyboardLinkedAssetId: scene?.storyboardLinkedAssetId,
    storyboardLinkedAssetDescription: scene?.storyboardLinkedAssetDescription,
    storyboardDirectorsNote: scene?.storyboardDirectorsNote,
    referenceImageBase64: scene?.referenceImageBase64,
    referenceImageMimeType: scene?.referenceImageMimeType,
});

type SceneReferencePickerState = {
    mode: 'base_asset' | 'reference_assets';
    sceneIndex: number;
};

const getSceneReferenceKey = (binding: Pick<SceneReferenceBinding, 'source' | 'assetId' | 'variantId' | 'sourceSceneId'>): string => (
    `${binding.source}:${binding.assetId}:${binding.variantId || ''}:${binding.sourceSceneId || ''}`
);

const buildSceneReferencePreviewUrl = (binding: Pick<SceneReferenceBinding, 'previewUrl' | 'base64' | 'mimeType'>): string | undefined => {
    if (binding.previewUrl) return binding.previewUrl;
    if (!binding.base64) return undefined;
    return binding.base64.startsWith('data:')
        ? binding.base64
        : `data:${binding.mimeType || 'image/png'};base64,${binding.base64}`;
};

const ensureStringArray = (value: unknown): string[] => {
    if (Array.isArray(value)) {
        return value.filter((entry): entry is string => typeof entry === 'string' && entry.trim().length > 0);
    }
    if (typeof value === 'string' && value.trim().length > 0) {
        return [value.trim()];
    }
    return [];
};

const parseReferenceLinks = (input: string): string[] => {
    return input
        .split(/[\n,]/)
        .map(part => part.trim())
        .filter(Boolean);
};

const withHttpProtocol = (value: string): string => {
    const trimmed = value.trim();
    if (!trimmed) return '';
    return /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
};

const formatReferenceLabel = (link: string): string => {
    const trimmed = link.trim();
    if (!trimmed) return '';
    try {
        const normalized = withHttpProtocol(trimmed);
        const parsed = new URL(normalized);
        const host = parsed.hostname.replace(/^www\./, '');
        let path = parsed.pathname === '/' ? '' : parsed.pathname;
        if (path.length > 24) {
            path = `${path.slice(0, 21)}...`;
        }
        return path ? `${host}${path}` : host;
    } catch {
        return trimmed.length > 28 ? `${trimmed.slice(0, 25)}...` : trimmed;
    }
};

const normalizeViralTopicFinderResult = (result: ViralTopicFinderResult): ViralTopicFinderResult => {
    return {
        ...result,
        personaSummary: {
            ...result.personaSummary,
            painPoints: ensureStringArray(result.personaSummary.painPoints),
            preferredPlatforms: ensureStringArray(result.personaSummary.preferredPlatforms),
            recommendedMoves: ensureStringArray(result.personaSummary.recommendedMoves)
        },
        globalHashtags: ensureStringArray(result.globalHashtags),
        trendInsights: ensureStringArray(result.trendInsights),
        freshnessRadar: ensureStringArray(result.freshnessRadar),
        ideas: Array.isArray(result.ideas) ? result.ideas : []
    };
};

const FONT_OPTIONS = [
    { label: 'Inter (Clean)', value: 'Inter' },
    { label: 'Montserrat (Viral)', value: 'Montserrat' },
    { label: 'Bangers (Loud)', value: 'Bangers' },
    { label: 'Playfair (Luxury)', value: 'Playfair Display' },
    { label: 'Roboto Mono (Tech)', value: 'Roboto Mono' },
    { label: 'Merriweather (Story)', value: 'Merriweather' },
    { label: 'Bebas Neue (Bold)', value: 'Bebas Neue' },
    { label: 'Oswald (Impact)', value: 'Oswald' },
];

// Researched viral caption presets based on top-performing content
const CAPTION_PRESETS = {
    // === VIRAL / HIGH ENERGY ===
    tiktok_classic: {
        id: 'tiktok_classic',
        name: 'TikTok Classic',
        category: 'viral',
        description: 'The OG viral style - white text, black outline, yellow highlight',
        preview: { text: 'VIRAL', style: { color: '#FFF', textShadow: '2px 2px 0 #000, -2px -2px 0 #000, 2px -2px 0 #000, -2px 2px 0 #000' } },
        settings: { style: 'viral' as const, displayMode: 'word-by-word' as const, fillColor: '#FFFFFF', outlineColor: '#000000', highlightColor: '#FFFF00', fontSize: 38, animation: 'pop' as const, fontFamily: 'Montserrat', strokeWidth: 8, uppercase: true }
    },
    capcut_green: {
        id: 'capcut_green',
        name: 'CapCut Signature',
        category: 'viral',
        description: 'Green highlight glow - the CapCut look everyone recognizes',
        preview: { text: 'CAPCUT', style: { color: '#FFF', textShadow: '0 0 10px #00FF00, 2px 2px 0 #000' } },
        settings: { style: 'karaoke' as const, displayMode: 'word-by-word' as const, fillColor: '#FFFFFF', highlightColor: '#00FF00', glowColor: '#00FF00', glowIntensity: 12, fontSize: 34, animation: 'bounce' as const, fontFamily: 'Bebas Neue', strokeWidth: 6, uppercase: true }
    },
    hormozi_style: {
        id: 'hormozi_style',
        name: 'Hormozi Style',
        category: 'viral',
        description: 'Bold yellow on black - high contrast educational content',
        preview: { text: 'MONEY', style: { color: '#FFD700', textShadow: '3px 3px 0 #000' } },
        settings: { style: 'viral' as const, displayMode: 'word-by-word' as const, fillColor: '#FFD700', outlineColor: '#000000', highlightColor: '#FFFFFF', fontSize: 36, animation: 'pop' as const, fontFamily: 'Bebas Neue', strokeWidth: 10, uppercase: true }
    },
    red_alert: {
        id: 'red_alert',
        name: 'Red Alert',
        category: 'viral',
        description: 'Urgent red outline - perfect for news, warnings, hot takes',
        preview: { text: 'URGENT', style: { color: '#FFF', textShadow: '2px 2px 0 #FF0000, -2px -2px 0 #000' } },
        settings: { style: 'viral' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', outlineColor: '#FF0000', highlightColor: '#FF0000', fontSize: 34, animation: 'pop' as const, fontFamily: 'Oswald', strokeWidth: 8, uppercase: true }
    },

    // === NEON / GLOW ===
    cyber_pink: {
        id: 'cyber_pink',
        name: 'Cyber Pink',
        category: 'neon',
        description: 'Hot pink neon glow - beauty, lifestyle, aesthetic content',
        preview: { text: 'GLOW', style: { color: '#FFF', textShadow: '0 0 10px #FF00FF, 0 0 20px #FF00FF' } },
        settings: { style: 'neon' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', glowColor: '#FF00FF', glowIntensity: 15, fontSize: 32, fontFamily: 'Oswald', strokeWidth: 6, uppercase: true }
    },
    electric_blue: {
        id: 'electric_blue',
        name: 'Electric Blue',
        category: 'neon',
        description: 'Cyan tech glow - gaming, tech reviews, futuristic vibes',
        preview: { text: 'TECH', style: { color: '#FFF', textShadow: '0 0 10px #00FFFF, 0 0 20px #00FFFF' } },
        settings: { style: 'neon' as const, displayMode: 'word-by-word' as const, fillColor: '#FFFFFF', highlightColor: '#00FFFF', glowColor: '#00FFFF', glowIntensity: 15, fontSize: 30, animation: 'pop' as const, fontFamily: 'Roboto Mono', strokeWidth: 6, uppercase: true }
    },
    sunset_glow: {
        id: 'sunset_glow',
        name: 'Sunset Glow',
        category: 'neon',
        description: 'Warm orange glow - travel, food, golden hour content',
        preview: { text: 'WARM', style: { color: '#FFF', textShadow: '0 0 10px #FF6B00, 0 0 20px #FF6B00' } },
        settings: { style: 'neon' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', glowColor: '#FF6B00', glowIntensity: 12, fontSize: 30, fontFamily: 'Montserrat', strokeWidth: 6 }
    },

    // === GRADIENT ===
    gen_z_gradient: {
        id: 'gen_z_gradient',
        name: 'Gen Z Gradient',
        category: 'gradient',
        description: 'Pink to cyan gradient - trendy, youthful, eye-catching',
        preview: { text: 'TRENDY', style: { background: 'linear-gradient(90deg, #FF00FF, #00FFFF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } },
        settings: { style: 'gradient' as const, displayMode: 'word-by-word' as const, gradientColors: ['#FF00FF', '#00FFFF'] as [string, string], fontSize: 34, animation: 'pop' as const, fontFamily: 'Bangers', strokeWidth: 6, uppercase: true }
    },
    fire_gradient: {
        id: 'fire_gradient',
        name: 'Fire Gradient',
        category: 'gradient',
        description: 'Red to yellow fire effect - hype, energy, motivation',
        preview: { text: 'FIRE', style: { background: 'linear-gradient(90deg, #FF0000, #FFD700)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } },
        settings: { style: 'gradient' as const, displayMode: 'word-by-word' as const, gradientColors: ['#FF0000', '#FFD700'] as [string, string], fontSize: 36, animation: 'bounce' as const, fontFamily: 'Bebas Neue', strokeWidth: 8, uppercase: true }
    },
    ocean_gradient: {
        id: 'ocean_gradient',
        name: 'Ocean Wave',
        category: 'gradient',
        description: 'Blue to teal gradient - calm, professional, trustworthy',
        preview: { text: 'FLOW', style: { background: 'linear-gradient(90deg, #0066FF, #00CED1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } },
        settings: { style: 'gradient' as const, displayMode: 'sentence' as const, gradientColors: ['#0066FF', '#00CED1'] as [string, string], fontSize: 30, animation: 'fade' as const, fontFamily: 'Inter', strokeWidth: 4 }
    },

    // === CLEAN / MINIMAL ===
    clean_white: {
        id: 'clean_white',
        name: 'Clean White',
        category: 'minimal',
        description: 'Minimal white on dark pill - professional, readable',
        preview: { text: 'Clean', style: { color: '#FFF', background: 'rgba(0,0,0,0.6)', padding: '4px 12px', borderRadius: '20px' } },
        settings: { style: 'clean' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', fontSize: 26, backgroundShape: 'pill' as const, backgroundOpacity: 0.7, fontFamily: 'Inter', strokeWidth: 0 }
    },
    soft_shadow: {
        id: 'soft_shadow',
        name: 'Soft Shadow',
        category: 'minimal',
        description: 'Subtle drop shadow - elegant, unobtrusive',
        preview: { text: 'Subtle', style: { color: '#FFF', textShadow: '2px 2px 4px rgba(0,0,0,0.5)' } },
        settings: { style: 'cinematic' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', fontSize: 24, fontFamily: 'Inter', strokeWidth: 0 }
    },
    dark_mode: {
        id: 'dark_mode',
        name: 'Dark Mode',
        category: 'minimal',
        description: 'Dark text on light backgrounds - inverted for bright videos',
        preview: { text: 'Dark', style: { color: '#1a1a1a', textShadow: '0 0 10px rgba(255,255,255,0.5)' } },
        settings: { style: 'clean' as const, displayMode: 'sentence' as const, fillColor: '#1A1A1A', outlineColor: '#FFFFFF', fontSize: 26, fontFamily: 'Inter', strokeWidth: 2, backgroundShape: 'pill' as const, backgroundOpacity: 0.8 }
    },

    // === CINEMATIC / LUXURY ===
    cinema_gold: {
        id: 'cinema_gold',
        name: 'Cinema Gold',
        category: 'cinematic',
        description: 'Golden luxury text - high-end brands, motivation',
        preview: { text: 'Luxury', style: { color: '#FFD700', fontStyle: 'italic', letterSpacing: '2px' } },
        settings: { style: 'cinematic' as const, displayMode: 'sentence' as const, fillColor: '#FFD700', fontSize: 28, fontFamily: 'Playfair Display', letterSpacing: 3, strokeWidth: 0 }
    },
    film_noir: {
        id: 'film_noir',
        name: 'Film Noir',
        category: 'cinematic',
        description: 'Classic film subtitle look - storytelling, drama',
        preview: { text: 'Story', style: { color: '#E0E0E0', fontStyle: 'italic' } },
        settings: { style: 'cinematic' as const, displayMode: 'sentence' as const, fillColor: '#E0E0E0', fontSize: 24, fontFamily: 'Merriweather', letterSpacing: 1, strokeWidth: 0 }
    },
    premium_white: {
        id: 'premium_white',
        name: 'Premium White',
        category: 'cinematic',
        description: 'Crisp white with subtle shadow - Apple-style elegance',
        preview: { text: 'Premium', style: { color: '#FFFFFF', textShadow: '0 2px 4px rgba(0,0,0,0.3)', letterSpacing: '3px' } },
        settings: { style: 'cinematic' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', fontSize: 26, fontFamily: 'Inter', letterSpacing: 4, strokeWidth: 0 }
    },

    // === FUN / PLAYFUL ===
    comic_pop: {
        id: 'comic_pop',
        name: 'Comic Pop',
        category: 'fun',
        description: 'Bold comic style - funny content, memes, reactions',
        preview: { text: 'POW!', style: { color: '#FFFF00', textShadow: '3px 3px 0 #FF0000, 6px 6px 0 #000' } },
        settings: { style: 'viral' as const, displayMode: 'word-by-word' as const, fillColor: '#FFFF00', outlineColor: '#FF0000', highlightColor: '#00FF00', fontSize: 38, animation: 'bounce' as const, fontFamily: 'Bangers', strokeWidth: 8, uppercase: true }
    },
    pastel_dream: {
        id: 'pastel_dream',
        name: 'Pastel Dream',
        category: 'fun',
        description: 'Soft pastel colors - aesthetic, ASMR, calming content',
        preview: { text: 'soft', style: { color: '#FFB6C1', textShadow: '2px 2px 0 #E6E6FA' } },
        settings: { style: 'clean' as const, displayMode: 'sentence' as const, fillColor: '#FFB6C1', outlineColor: '#E6E6FA', fontSize: 28, fontFamily: 'Inter', strokeWidth: 4 }
    },
    rainbow_burst: {
        id: 'rainbow_burst',
        name: 'Rainbow Burst',
        category: 'fun',
        description: 'Multi-color gradient - celebrations, announcements',
        preview: { text: 'PARTY', style: { background: 'linear-gradient(90deg, #FF0000, #FF7F00, #FFFF00, #00FF00, #0000FF, #8B00FF)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' } },
        settings: { style: 'gradient' as const, displayMode: 'word-by-word' as const, gradientColors: ['#FF0000', '#8B00FF'] as [string, string], fontSize: 36, animation: 'bounce' as const, fontFamily: 'Bangers', strokeWidth: 6, uppercase: true }
    },

    // === 2024 TRENDING ===
    mr_beast: {
        id: 'mr_beast',
        name: 'MrBeast Style',
        category: 'viral',
        description: 'Bold white + thick black outline - YouTube thumbnail energy',
        preview: { text: '$1M', style: { color: '#FFFFFF', textShadow: '4px 4px 0 #000, -4px -4px 0 #000, 4px -4px 0 #000, -4px 4px 0 #000', fontFamily: 'Bebas Neue' } },
        settings: { style: 'viral' as const, displayMode: 'word-by-word' as const, fillColor: '#FFFFFF', outlineColor: '#000000', highlightColor: '#00FF00', fontSize: 40, animation: 'pop' as const, fontFamily: 'Bebas Neue', strokeWidth: 12, uppercase: true }
    },
    asmr_soft: {
        id: 'asmr_soft',
        name: 'ASMR Soft',
        category: 'minimal',
        description: 'Whisper-quiet aesthetic - ASMR, meditation, calm',
        preview: { text: 'whisper', style: { color: '#D4C5B9', fontFamily: 'Merriweather', fontStyle: 'italic', letterSpacing: '3px' } },
        settings: { style: 'clean' as const, displayMode: 'sentence' as const, fillColor: '#D4C5B9', fontSize: 22, fontFamily: 'Merriweather', letterSpacing: 3, strokeWidth: 0 }
    },
    podcast_clip: {
        id: 'podcast_clip',
        name: 'Podcast Clip',
        category: 'minimal',
        description: 'Clean readable style for podcast highlights',
        preview: { text: 'Quote', style: { color: '#FFFFFF', background: 'rgba(0,0,0,0.8)', padding: '6px 16px', borderRadius: '8px' } },
        settings: { style: 'box' as const, displayMode: 'sentence' as const, fillColor: '#FFFFFF', fontSize: 24, fontFamily: 'Inter', backgroundShape: 'box' as const, backgroundOpacity: 0.85, strokeWidth: 0 }
    },
    gaming_hype: {
        id: 'gaming_hype',
        name: 'Gaming Hype',
        category: 'neon',
        description: 'RGB gaming aesthetic - esports, gaming clips',
        preview: { text: 'GG', style: { color: '#00FF00', textShadow: '0 0 10px #00FF00, 0 0 20px #FF00FF' } },
        settings: { style: 'neon' as const, displayMode: 'word-by-word' as const, fillColor: '#00FF00', highlightColor: '#FF00FF', glowColor: '#00FF00', glowIntensity: 18, fontSize: 36, animation: 'bounce' as const, fontFamily: 'Roboto Mono', strokeWidth: 4, uppercase: true }
    },
    luxury_brand: {
        id: 'luxury_brand',
        name: 'Luxury Brand',
        category: 'cinematic',
        description: 'High-end minimalist - fashion, luxury products',
        preview: { text: 'LUXE', style: { color: '#C9B037', letterSpacing: '8px', fontFamily: 'Playfair Display' } },
        settings: { style: 'cinematic' as const, displayMode: 'sentence' as const, fillColor: '#C9B037', fontSize: 26, fontFamily: 'Playfair Display', letterSpacing: 6, strokeWidth: 0, uppercase: true }
    },
    tiktok_2024: {
        id: 'tiktok_2024',
        name: 'TikTok 2024',
        category: 'viral',
        description: 'Latest TikTok trend - white/yellow word-by-word',
        preview: { text: 'TREND', style: { color: '#FFFF00', textShadow: '2px 2px 0 #000, -2px -2px 0 #000' } },
        settings: { style: 'viral' as const, displayMode: 'word-by-word' as const, fillColor: '#FFFFFF', outlineColor: '#000000', highlightColor: '#FFFF00', fontSize: 34, animation: 'pop' as const, fontFamily: 'Montserrat', strokeWidth: 8, uppercase: true }
    },
};
const DEFAULT_EXPORT_PRESETS: ExportPreset[] = [
    {
        id: 'instagram-portrait',
        label: 'Instagram Reel / TikTok',
        description: 'IG Reels / TikTok ready MP4 (9:16)',
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        format: 'mp4',
        videoBitrate: 12_000_000,
        audioBitrate: 192_000,
    },
    {
        id: 'square-feed',
        label: 'Square Feed 1080p',
        description: 'Instagram + LinkedIn feed safe (1:1)',
        aspectRatio: '1:1',
        width: 1080,
        height: 1080,
        format: 'mp4',
        videoBitrate: 10_000_000,
        audioBitrate: 160_000,
    },
    {
        id: 'landscape-short',
        label: 'Landscape Short 1080p',
        description: 'YouTube Shorts cross-post (16:9 crop)',
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
        format: 'mp4',
        videoBitrate: 14_000_000,
        audioBitrate: 192_000,
    },
    {
        id: 'webm-master',
        label: 'WebM Master',
        description: 'High-fidelity VP9 for further editing',
        aspectRatio: '9:16',
        width: 1080,
        height: 1920,
        format: 'webm',
        videoBitrate: 15_000_000,
        audioBitrate: 192_000,
    },
    {
        id: 'youtube-landscape',
        label: 'YouTube Full HD',
        description: 'Standard YouTube Landscape (16:9)',
        aspectRatio: '16:9',
        width: 1920,
        height: 1080,
        format: 'mp4',
        videoBitrate: 16_000_000,
        audioBitrate: 320_000,
    },
    {
        id: 'youtube-4k',
        label: 'YouTube 4K',
        description: 'Ultra HD for YouTube (16:9)',
        aspectRatio: '16:9',
        width: 3840,
        height: 2160,
        format: 'mp4',
        videoBitrate: 45_000_000,
        audioBitrate: 320_000,
    },
];

const DURATION_PRESETS = [
    { label: 'Auto', value: 0 },
    { label: '15s', value: 15 },
    { label: '30s', value: 30 },
    { label: '45s', value: 45 },
    { label: '60s', value: 60 },
    { label: '90s', value: 90 },
];

const MIN_CUSTOM_DURATION = 5;
const MAX_CUSTOM_DURATION = 120;
const CUSTOM_DURATION_OPTION_VALUE = -1;
const IDEA_DURATION_USE_GLOBAL_VALUE = -2;
const isPresetDurationValue = (value: number) => DURATION_PRESETS.some((preset) => preset.value === value);
const clampDurationValue = (value: number) => Math.min(MAX_CUSTOM_DURATION, Math.max(MIN_CUSTOM_DURATION, value));
/** Resolve reel target: 0 means Auto (leave unset for planner). Never clamp Auto to 5s. */
const resolveEffectiveTargetDuration = (raw: number): number => {
    if (!Number.isFinite(raw) || raw === 0) return 0;
    return clampDurationValue(raw);
};

const deriveClipDuration = (clip: UploadedMedia): number => {
    const MAX_CLIP_DURATION = 30;
    // Priority 1: extendedDuration (manually set in Video Extension Studio)
    if (typeof clip.extendedDuration === 'number' && Number.isFinite(clip.extendedDuration)) {
        return Math.max(0.7, Math.min(MAX_CLIP_DURATION, clip.extendedDuration));
    }

    // Priority 2: trimmed duration (endTime - startTime)
    const start = typeof clip.startTime === 'number' ? clip.startTime : 0;
    if (typeof clip.endTime === 'number') {
        const span = clip.endTime - start;
        if (Number.isFinite(span) && span > 0) {
            return Math.max(0.7, Math.min(MAX_CLIP_DURATION, span));
        }
    }

    // Priority 3: clip.duration or default
    return Math.max(0.7, Math.min(MAX_CLIP_DURATION, clip.duration || 3));
};

const toDataUrl = (base64?: string, mimeType = 'image/png'): string => {
    if (!base64) return '';
    if (base64.startsWith('data:') || base64.startsWith('blob:') || base64.startsWith('http')) {
        return base64;
    }
    return `data:${mimeType};base64,${base64}`;
};

const normalizeMediaIdentity = (items: UploadedMedia[]): UploadedMedia[] => {
    return items.map((item) => {
        const sceneId = item.sceneId || item.id || getSceneDraftId();
        return {
            ...item,
            id: item.id || sceneId,
            sceneId,
        };
    });
};

const restorePersistedMediaItems = (items: Array<Partial<UploadedMedia>>): UploadedMedia[] => {
    return normalizeMediaIdentity(items.map((item, index) => {
        const sceneId = item.sceneId || item.id || getSceneDraftId();
        const previewUrl = item.previewUrl
            || getMediaDisplayUrl(item as Pick<UploadedMedia, 'previewUrl' | 'base64' | 'mimeType'>)
            || item.src
            || item.thumbnailUrl
            || item.thumbnail
            || '';
        const mimeType = item.mimeType || 'image/png';
        const fallbackName = item.name || `scene_${index + 1}.${mimeType.split('/')[1] || 'png'}`;

        return {
            ...(item as UploadedMedia),
            id: item.id || sceneId,
            sceneId,
            file: (item.file as File) || new File([], fallbackName, { type: mimeType }),
            previewUrl,
            thumbnailUrl: item.thumbnailUrl || item.thumbnail || previewUrl,
            type: (item.type as 'image' | 'video') || 'image',
            mimeType,
            duration: typeof item.duration === 'number' ? item.duration : 3,
        };
    }));
};

const restorePersistedSceneDrafts = (
    savedDrafts: Array<Partial<SceneDraft>>,
    fallbackMedia: UploadedMedia[] = [],
): { drafts: SceneDraft[]; media: UploadedMedia[] } => {
    const restoredDrafts = savedDrafts.map((draft, index) => {
        const sceneId = draft.id || draft.media?.sceneId || draft.media?.id || getSceneDraftId();
        const restoredMedia = draft.media
            ? restorePersistedMediaItems([{ ...(draft.media as Partial<UploadedMedia>), id: draft.media.id || sceneId, sceneId }])[0]
            : undefined;
        const restoredVariants = draft.imageVariants?.map((variant, variantIndex) => ({
            ...variant,
            media: restorePersistedMediaItems([{
                ...(variant.media as Partial<UploadedMedia>),
                id: variant.media?.id || `${sceneId}-variant-${variantIndex}`,
                sceneId,
            }])[0],
        }));
        return {
            ...(draft as SceneDraft),
            id: sceneId,
            sceneNumber: index + 1,
            media: restoredMedia,
            imageVariants: restoredVariants,
        };
    });
    const mediaPool = fallbackMedia.length > 0
        ? fallbackMedia
        : restorePersistedMediaItems(
            restoredDrafts
                .map((draft) => draft.media)
                .filter((item): item is UploadedMedia => Boolean(item)),
        );
    const synced = syncStoryboardMetadataAcrossDraftsAndMedia(restoredDrafts, mediaPool);
    return {
        drafts: synced.drafts,
        media: synced.media.length > 0 ? synced.media : deriveMediaFromSceneDrafts(synced.drafts),
    };
};

const buildStoryboardContinuitySummary = (items: Array<Partial<ApprovedStoryboardSceneMetadata>>) => {
    const productMap = new Map<string, { label: string; count: number }>();
    const routeMap = new Map<string, { label: string; count: number }>();
    let assetBackedCount = 0;

    items.forEach((item) => {
        const productKey = item.productId || item.productTitle || item.productUrl || '';
        const productLabel = item.productTitle || item.productId || item.productUrl;
        if (productKey && productLabel) {
            const existing = productMap.get(productKey);
            productMap.set(productKey, {
                label: productLabel,
                count: (existing?.count || 0) + 1,
            });
        }

        const effectiveRoute = getEffectiveStoryboardRoute(item);
        if (effectiveRoute) {
            const existing = routeMap.get(effectiveRoute);
            routeMap.set(effectiveRoute, {
                label: getScriptStudioRouteLabel(effectiveRoute),
                count: (existing?.count || 0) + 1,
            });
        }

        if (item.storyboardBaseAssetId || item.storyboardLinkedAssetId) {
            assetBackedCount += 1;
        }
    });

    return {
        sceneCount: items.length,
        productLanes: Array.from(productMap.values()),
        routeBuckets: Array.from(routeMap.values()),
        routeCount: routeMap.size,
        assetBackedCount,
    };
};

const App: React.FC = () => {
    const { session, signOut, refreshHistory, history } = useAuth();
    const [isAddingScene, setIsAddingScene] = useState(false);
    const [addScenePrompt, setAddScenePrompt] = useState('');

    // --- STATE ---
    const [step, setStep] = useState<AppStep>(AppStep.LANDING);
    const [creationMode, setCreationMode] = useState<CreationMode | null>(null);
    /** Which Agent Hub runner to show when creationMode === AGENT_CONSOLE. */
    const [hubConsoleAgentId, setHubConsoleAgentId] = useState<string>('ad-agent');
    const [media, setMedia] = useState<UploadedMedia[]>([]);
    const [textToReelTopic, setTextToReelTopic] = useState('');
    const [topicPersona, setTopicPersona] = useState('');
    const [topicCreatorUrl, setTopicCreatorUrl] = useState('');
    const [topicReferenceInput, setTopicReferenceInput] = useState('');
    const [topicIdeaCount, setTopicIdeaCount] = useState<number>(6);
    const [userPrompt, setUserPrompt] = useState('');
    const [script, setScript] = useState<ReelScript | null>(null);
    const [isFindingTopics, setIsFindingTopics] = useState(false);
    const [topicFinderResult, setTopicFinderResult] = useState<ViralTopicFinderResult | null>(null);
    const [topicIdeas, setTopicIdeas] = useState<ViralTopicIdea[]>([]);
    const [showTopicIdeasPanel, setShowTopicIdeasPanel] = useState(false);
    const [showTopicAdvanced, setShowTopicAdvanced] = useState(false);
    const [textModel, setTextModel] = useState<PlannerModelId>(
      () => getStoredPreferredPlannerModel() || DEFAULT_PLANNER_MODEL,
    );
    const [showBrandKitPanel, setShowBrandKitPanel] = useState(false);
    const [editingIdeaId, setEditingIdeaId] = useState<string | null>(null);
    const [editingIdeaText, setEditingIdeaText] = useState('');
    const [regeneratingIdeaId, setRegeneratingIdeaId] = useState<string | null>(null);

    const [pendingBrandAutoApprove, setPendingBrandAutoApprove] = useState(false);
    const [selectedIdeaMeta, setSelectedIdeaMeta] = useState<ViralTopicIdea | null>(null);
    const referenceLinks = useMemo(() => parseReferenceLinks(topicReferenceInput), [topicReferenceInput]);

    // Timeout wrapper to prevent long agent hangs
    const withTimeout = useCallback(<T,>(promise: Promise<T>, ms: number, label: string, fallback?: T): Promise<T> => {
        return new Promise<T>((resolve, reject) => {
            const timer = setTimeout(() => {
                console.warn(`[Timeout] ${label} exceeded ${ms}ms`);
                if (fallback !== undefined) resolve(fallback);
                else reject(new Error(`${label} timed out after ${ms}ms`));
            }, ms);
            promise
                .then(val => { clearTimeout(timer); resolve(val); })
                .catch(err => { clearTimeout(timer); reject(err); });
        });
    }, []);

    // Settings
    const [selectedVoiceId, setSelectedVoiceId] = useState<string | 'Custom'>(DEFAULT_VOICE_OPTION.id);
    const [selectedStyle, setSelectedStyle] = useState<ScriptStyle>(ScriptStyle.Professional);
    const [videoSpeed, setVideoSpeed] = useState<number>(1.0);
    const [targetDuration, setTargetDuration] = useState<number>(30); // Default to 30s when Auto
    const [customDurationInput, setCustomDurationInput] = useState<string>('');
    const [enableVoiceover, setEnableVoiceover] = useState<boolean>(true);
    const [enableCaptions, setEnableCaptions] = useState<boolean>(true);

    // Post-Production State
    const [visualSettings, setVisualSettings] = useState<VisualSettings>({ brightness: 1, contrast: 1, saturation: 1, enableZoom: true, filterPreset: 'none', vignette: 0, grain: 0, framingMode: 'cover', framingFocusY: 0.5 });
    const [isAutoDirecting, setIsAutoDirecting] = useState(false);
    const [subtitleSettings, setSubtitleSettings] = useState<SubtitleSettings>({ ...DEFAULT_SUBTITLE_SETTINGS });
    const [audioMix, setAudioMix] = useState<AudioMixSettings>({ ...DEFAULT_AUDIO_MIX_SETTINGS });
    const [studioTab, setStudioTab] = useState<'visuals' | 'captions' | 'audio' | 'effects'>('visuals');
    const [availableExportPresets] = useState<ExportPreset[]>(DEFAULT_EXPORT_PRESETS);
    const [selectedExportPresetId, setSelectedExportPresetId] = useState<string>(DEFAULT_EXPORT_PRESETS[0].id);

    // Brand & Music
    const [brandKit, setBrandKit] = useState<BrandKit>({});
    const [brandAssetCatalog, setBrandAssetCatalog] = useState<BrandAssetCatalogEntry[]>([]);
    const [showBrandKit, setShowBrandKit] = useState(false);
    const [showAudioSettings, setShowAudioSettings] = useState(false);
    const [musicVibeDescription, setMusicVibeDescription] = useState('');
    const [customMusicPrompt, setCustomMusicPrompt] = useState('');
    const [preUploadedMusic, setPreUploadedMusic] = useState<File | null>(null);

    // Logic State
    const [isGeneratingAudio, setIsGeneratingAudio] = useState(false);
    const [audioProgress, setAudioProgress] = useState({ completed: 0, total: 0 });
    const [audioBuffer, setAudioBuffer] = useState<AudioBuffer | null>(null);
    const [slideDurations, setSlideDurations] = useState<number[]>([]);
    const [audioSegmentDurations, setAudioSegmentDurations] = useState<number[]>([]);
    // Voice samples stay at their generated cadence; scene slack is silent.
    const voiceTimelinePlaybackRate = 1;
    const [exportTriggerKey, setExportTriggerKey] = useState(0);
    const [bgMusicBuffer, setBgMusicBuffer] = useState<AudioBuffer | null>(null);
    const [musicHistory, setMusicHistory] = useState<GeneratedMusicTrack[]>([]);
    const [selectedTrackId, setSelectedTrackId] = useState<string | null>(null);
    const [isGeneratingMusic, setIsGeneratingMusic] = useState(false);
    const [isAnalyzingMusic, setIsAnalyzingMusic] = useState(false);
    const [isSuggestingCaptionStyle, setIsSuggestingCaptionStyle] = useState(false);
    const [aiCaptionSuggestion, setAiCaptionSuggestion] = useState<CaptionStyleSuggestion | null>(null);
    const autoCaptionStyleRanRef = useRef(false);
    const [musicPanelTab, setMusicPanelTab] = useState<'generate' | 'upload'>('generate');
    const [uploadedMusicAnalysis, setUploadedMusicAnalysis] = useState<MusicAnalysis | null>(null);
    const [isPlayingMusicPreview, setIsPlayingMusicPreview] = useState(false);
    const musicPreviewSource = useRef<AudioBufferSourceNode | null>(null);
    const voicePreviewSource = useRef<AudioBufferSourceNode | null>(null);
    const voicePreviewContextRef = useRef<AudioContext | null>(null);
    const [playingVoicePreview, setPlayingVoicePreview] = useState<string | null>(null);

    // Text-to-Reel Generation
    const [reelPlan, setReelPlan] = useState<ReelPlan | null>(null);
    const [sceneDrafts, setSceneDrafts] = useState<SceneDraft[]>([]);
    const [generatedImagesCount, setGeneratedImagesCount] = useState(0);
    const [generationStep, setGenerationStep] = useState(0);
    const [generationStatusText, setGenerationStatusText] = useState('');
    const [isRegenerating, setIsRegenerating] = useState(false);
    const [regenFeedback, setRegenFeedback] = useState('');
    const [ecoMode, setEcoMode] = useState(true);

    // Editing State
    const [editingCardIndex, setEditingCardIndex] = useState<number | null>(null);
    const [customRewriteText, setCustomRewriteText] = useState('');
    const [showUsageStats, setShowUsageStats] = useState(false);
    const [planImageActionIndex, setPlanImageActionIndex] = useState<number | null>(null);
    const [isAiAddingPlanScene, setIsAiAddingPlanScene] = useState(false);
    const [proposedSegments, setProposedSegments] = useState<VideoSegment[]>([]);
    const [isSegmenting, setIsSegmenting] = useState(false);
    const [isAnalyzingContext, setIsAnalyzingContext] = useState(false);
    const [isPlaying, setIsPlaying] = useState(false);
    const [isScriptLoading, setIsScriptLoading] = useState(false);

    // Voice Recording
    const [showVoiceRecorder, setShowVoiceRecorder] = useState(false);
    const [notice, setNotice] = useState<{ type: 'error' | 'info' | 'warning'; message: string } | null>(null);
    const noticeTimeoutRef = useRef<number | null>(null);
    const [videoStudioStartIndex, setVideoStudioStartIndex] = useState(0);
    const [activePreviewSceneIndex, setActivePreviewSceneIndex] = useState(0);
    const [songToVideoState, setSongToVideoState] = useState<SongToVideoState | null>(null);
    const [showProjects, setShowProjects] = useState(false);
    const [lastAutosave, setLastAutosave] = useState<Date | null>(null);
    const sceneAudioCacheRef = useRef<Record<string, AudioBuffer>>({});
    const generatedVoiceSyncSignatureRef = useRef<string>('');
    const audioGenerationRunRef = useRef(0);
    const sceneImageInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
    const [sceneReferencePickerState, setSceneReferencePickerState] = useState<SceneReferencePickerState | null>(null);
    const addScenePanelRef = useRef<HTMLDivElement | null>(null);
    const normalizedBrandAssetScenesRef = useRef<Set<string>>(new Set());
    const scrollToAddSceneSection = useCallback(() => scrollScenePanelIntoView(addScenePanelRef), []);
    const selectedExportPreset = useMemo(() =>
        availableExportPresets.find(p => p.id === selectedExportPresetId) || availableExportPresets[0],
        [availableExportPresets, selectedExportPresetId]
    );
    const selectedVoiceOption = useMemo(
        () => AVAILABLE_VOICE_OPTIONS.find(voice => voice.id === selectedVoiceId) || DEFAULT_VOICE_OPTION,
        [selectedVoiceId],
    );
    const voiceSyncSignature = useMemo(
        () => buildVoiceSyncSignature(sceneDrafts, selectedVoiceOption),
        [sceneDrafts, selectedVoiceOption],
    );
    const storyboardContinuitySummary = useMemo(
        () => buildStoryboardContinuitySummary(media),
        [media],
    );
    const activePreviewScene = useMemo(() => {
        if (!media.length) return undefined;
        return media[Math.min(activePreviewSceneIndex, media.length - 1)];
    }, [activePreviewSceneIndex, media]);

    const viralScore = useMemo(() => computeViralScore(visualSettings, media.length), [visualSettings, media.length]);
    const activePreviewRoute = useMemo(
        () => activePreviewScene ? getEffectiveStoryboardRoute(activePreviewScene) : undefined,
        [activePreviewScene],
    );
    // Mode-specific milestones for accurate progress display (must match generationStep values).
    const textToReelMilestones = [
        { title: "Refining Intent", subtitle: "Interrogating your prompt like a detective." },
        { title: "Trend & Research", subtitle: "Eavesdropping on the explore page." },
        { title: "Building Plan", subtitle: "Crafting the cult-classic plot arc." },
        { title: "Creating Visuals", subtitle: "Generating scene images that match the storyboard." },
        { title: "Writing Script", subtitle: "Locking narration and on-screen lines." },
    ];
    const mediaUploadMilestones = [
        { title: "Analyzing Media", subtitle: "Understanding your visual story." },
        { title: "Script Generation", subtitle: "Crafting hooks that stop the scroll." },
        { title: "Final Assembly", subtitle: "Sprinkling virality dust everywhere." }
    ];
    const milestoneMeta = creationMode === CreationMode.TEXT_TO_REEL ? textToReelMilestones : mediaUploadMilestones;
    const generationQuips = [
        "Consulting the algorithmic gossip column…",
        "Bribing trend goblins with matcha shots…",
        "Decoding competitors’ secret handshakes…",
        "Negotiating with a dramatic storyboard oracle…",
        "Preheating the virality cauldron…"
    ];
    const [generationQuipIndex, setGenerationQuipIndex] = useState(0);

    const scenesRequiringAiCount = reelPlan ? reelPlan.scenes.filter(scene => !scene.userProvidedImage).length : 0;
    const providedScenesCount = reelPlan ? reelPlan.scenes.length - scenesRequiringAiCount : 0;

    useEffect(() => {
        if (step !== AppStep.GENERATING_ASSETS) return;
        const interval = setInterval(() => {
            setGenerationQuipIndex(prev => (prev + 1) % generationQuips.length);
        }, 3500);
        return () => clearInterval(interval);
    }, [step]);

    // Load audio for Song to Video mode
    useEffect(() => {
        if (creationMode !== CreationMode.SONG_TO_VIDEO || !songToVideoState) return;

        const loadAudio = async () => {
            try {
                let arrayBuffer: ArrayBuffer | null = null;
                if (songToVideoState.audioBase64) {
                    const binary = atob(songToVideoState.audioBase64);
                    const bytes = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
                    arrayBuffer = bytes.buffer;
                } else if (songToVideoState.audioUrl) {
                    const response = await fetch(songToVideoState.audioUrl);
                    arrayBuffer = await response.arrayBuffer();
                }
                if (!arrayBuffer) return;
                const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
                const decoded = await ctx.decodeAudioData(arrayBuffer.slice(0));
                setBgMusicBuffer(decoded);
            } catch (error) {
                console.error("Failed to load song audio", error);
            }
        };
        loadAudio();
    }, [creationMode, songToVideoState?.audioUrl, songToVideoState?.audioBase64]);

    useEffect(() => {
        usageTracker.reset();
    }, []);

    useEffect(() => {
        if (media.length === 0) {
            setActivePreviewSceneIndex(0);
            return;
        }
        setActivePreviewSceneIndex(prev => Math.min(prev, media.length - 1));
    }, [media.length]);

    useEffect(() => {
        if (sceneDrafts.length === 0) return;
        setMedia(deriveMediaFromSceneDrafts(sceneDrafts));
        setScript(prev => deriveScriptFromSceneDrafts(prev, sceneDrafts));
        setSlideDurations(deriveSlideDurationsFromSceneDrafts(sceneDrafts));
    }, [sceneDrafts]);

    useEffect(() => {
        setSceneDrafts(prev => prev.map((draft) => {
            if (!draft.voiceAsset) return draft;
            if (selectedVoiceId === 'Custom') {
                return {
                    ...draft,
                    generationStatus: {
                        ...draft.generationStatus,
                        voice: 'stale',
                    },
                };
            }
            return draft.voiceAsset.voiceId !== selectedVoiceId ? {
                ...draft,
                generationStatus: {
                    ...draft.generationStatus,
                    voice: 'stale',
                },
            } : draft;
        }));
    }, [selectedVoiceId]);

    useEffect(() => {
        setBrandKit(prev => {
            if (brandAssetCatalog.length === 0 && !prev.assetCatalog?.length) {
                return prev;
            }
            return { ...prev, assetCatalog: brandAssetCatalog };
        });
    }, [brandAssetCatalog]);

    useEffect(() => {
        if (step !== AppStep.ANALYZE_SCRIPT || !brandKit.productImages?.length) return;

        setSceneDrafts(prev => {
            let changed = false;
            const nextDrafts = prev.map((draft) => {
                if (draft.imageSource !== 'brand_edit' || normalizedBrandAssetScenesRef.current.has(draft.id)) {
                    return draft;
                }

                const catalogEntry = draft.brandAssetId
                    ? brandAssetCatalog.find((entry) => entry.assetId === draft.brandAssetId)
                    : (typeof draft.brandImageIndex === 'number'
                        ? brandAssetCatalog.find((entry) => entry.imageIndex === draft.brandImageIndex)
                        : undefined);
                const imageIndex = draft.brandImageIndex ?? catalogEntry?.imageIndex;
                if (typeof imageIndex !== 'number') return draft;

                const brandAsset = brandKit.productImages?.[imageIndex];
                if (!brandAsset) return draft;

                const shouldLock = shouldPreferExactBrandAssetScene({
                    visualDescription: draft.visualDescription,
                    imagePrompt: draft.imagePrompt,
                    scriptGuidance: draft.voiceoverText || draft.onScreenText,
                    brandAssetEditAction: draft.brandAssetEditAction,
                }, catalogEntry);
                if (!shouldLock) return draft;

                const nextDuration = clampSceneDuration(draft.requestedDurationSec || draft.resolvedDurationSec);
                const previewUrl = brandAsset.previewUrl || toDataUrl(brandAsset.base64, brandAsset.mimeType);
                normalizedBrandAssetScenesRef.current.add(draft.id);
                changed = true;

                return {
                    ...draft,
                    imageSource: 'brand_asset',
                    brandAssetEditAction: 'use_as_is',
                    generationStatus: {
                        ...draft.generationStatus,
                        image: 'clean',
                    },
                    media: {
                        ...(draft.media || {
                            id: draft.id,
                            sceneId: draft.id,
                            file: brandAsset.file || new File([], `brand_asset_${imageIndex}.jpg`),
                            type: 'image',
                            mimeType: brandAsset.mimeType,
                            previewUrl,
                        }),
                        id: draft.id,
                        sceneId: draft.id,
                        file: brandAsset.file || new File([], `brand_asset_${imageIndex}.jpg`),
                        previewUrl,
                        thumbnailUrl: previewUrl,
                        base64: brandAsset.base64,
                        mimeType: brandAsset.mimeType,
                        type: 'image',
                        duration: nextDuration,
                        extendedDuration: nextDuration,
                        assetOrigin: 'brand_asset',
                        brandAssetId: catalogEntry?.assetId,
                        description: draft.visualDescription,
                        imagePrompt: draft.imagePrompt,
                    },
                };
            });

            return changed ? nextDrafts : prev;
        });
    }, [brandAssetCatalog, brandKit.productImages, step]);

    useEffect(() => {
        if (step !== AppStep.ANALYZE_SCRIPT || !reelPlan?.scenes?.length) return;

        setSceneDrafts(prev => {
            let changed = false;
            const nextDrafts = prev.map((draft, index) => {
                const currentScriptText = (draft.voiceoverText || draft.onScreenText || '').trim();
                const currentPrompt = (draft.imagePrompt || '').trim();
                const plannedScript = cleanScriptText(reelPlan.scenes[index]?.scriptGuidance || '');

                if (!currentScriptText || !plannedScript) return draft;
                const scriptMatchesPrompt = Boolean(currentPrompt && currentScriptText === currentPrompt && plannedScript !== currentPrompt && isLikelyVisualPromptText(currentPrompt));
                const scriptLooksBroken = isBrokenRewriteOutput(currentScriptText);
                if (!scriptMatchesPrompt && !scriptLooksBroken) return draft;

                changed = true;
                return {
                    ...draft,
                    onScreenText: plannedScript,
                    voiceoverText: plannedScript,
                    generationStatus: {
                        ...draft.generationStatus,
                        voice: 'stale',
                    },
                    voiceAsset: undefined,
                };
            });

            return changed ? nextDrafts : prev;
        });
    }, [reelPlan, step]);

    useEffect(() => {
        // Skip when captions are off — saves a TEXT_MODEL call every preview enter.
        if (step !== AppStep.PREVIEW || !script || !enableCaptions || autoCaptionStyleRanRef.current) return;
        // Don't clobber intentional Typography edits — only auto-style from production defaults.
        const stillDefaultCaptions =
            subtitleSettings.fontFamily === DEFAULT_SUBTITLE_SETTINGS.fontFamily
            && subtitleSettings.style === DEFAULT_SUBTITLE_SETTINGS.style
            && subtitleSettings.fontSize === DEFAULT_SUBTITLE_SETTINGS.fontSize;
        if (!stillDefaultCaptions) {
            autoCaptionStyleRanRef.current = true;
            return;
        }
        autoCaptionStyleRanRef.current = true;
        setIsSuggestingCaptionStyle(true);

        const visualDescs = sceneDrafts?.map(d => d.visualDescription).filter(Boolean) || media.map(m => m.description).filter(Boolean);
        const videoTopic = textToReelTopic || reelPlan?.topic || userPrompt || script?.title || '';

        suggestCaptionStyle(script.fullText || script.hook, selectedStyle, {
            brandColors: brandKit?.hexColor ? [brandKit.hexColor] : undefined,
            videoTopic,
            brandAesthetic: brandKit?.aestheticAnalysis || brandKit?.visualSignature,
            visualDescriptions: visualDescs as string[],
        }).then(suggestion => {
            setAiCaptionSuggestion(suggestion);
            const calmMood = suggestion.mood === 'calm' || suggestion.mood === 'luxurious' || suggestion.mood === 'professional';
            const elegantStyle = suggestion.style === 'cinematic' || suggestion.style === 'clean';
            const suggestedSize = Math.max(
                34,
                suggestion.fontSize ?? (calmMood || elegantStyle ? 34 : 38),
            );
            setSubtitleSettings(prev => ({
                ...prev,
                style: suggestion.style as any,
                animation: suggestion.animation as any,
                fontFamily: suggestion.fontFamily,
                displayMode: suggestion.displayMode,
                fillColor: suggestion.colorScheme.fillColor,
                outlineColor: suggestion.colorScheme.outlineColor,
                highlightColor: suggestion.colorScheme.highlightColor,
                glowColor: suggestion.colorScheme.glowColor,
                gradientColors: suggestion.colorScheme.gradientColors,
                fontSize: suggestedSize,
                strokeWidth: suggestion.strokeWidth ?? (elegantStyle ? 2 : 8),
                uppercase: suggestion.uppercase ?? !elegantStyle,
                letterSpacing: elegantStyle ? 1 : 0,
            }));
        }).catch(e => {
            console.error('Auto AI suggestion failed', e);
        }).finally(() => {
            setIsSuggestingCaptionStyle(false);
        });
    }, [step, script, sceneDrafts, media, textToReelTopic, reelPlan, userPrompt, selectedStyle, brandKit, enableCaptions, subtitleSettings.fontFamily, subtitleSettings.style, subtitleSettings.fontSize, setSubtitleSettings]);

    const milestoneCount = milestoneMeta.length;
    const normalizedStep = Math.min(milestoneCount, Math.max(0, generationStep));
    const visualStep = normalizedStep === 0 ? 1 : normalizedStep;
    const generationProgress = milestoneCount === 0 ? 0 : Math.min(100, Math.max(0, (normalizedStep / milestoneCount) * 100));
    const currentMilestone = milestoneMeta[Math.max(0, Math.min(milestoneCount - 1, visualStep - 1))];
    const nextMilestone = milestoneMeta[Math.max(0, Math.min(milestoneCount - 1, visualStep))];
    const hasProductBackedPlan = Boolean(
        brandKit.productImages?.length
        && reelPlan?.scenes?.some((scene) => scene.userProvidedImage || scene.brandImageIndex !== undefined || scene.brandAssetEditAction),
    );

    const handleStartOver = () => {
        usageTracker.reset();
        window.location.reload();
    };

    const performAutosave = async () => {
        if (!session?.user || step === AppStep.LANDING) return;

        // Generate intelligent session name
        let sessionName = 'Untitled Session';

        if (script?.title) {
            sessionName = script.title;
        } else if (script?.hook) {
            sessionName = script.hook.substring(0, 30) + (script.hook.length > 30 ? '...' : '');
        } else if (textToReelTopic) {
            sessionName = textToReelTopic;
        } else if (reelPlan?.topic) {
            sessionName = reelPlan.topic;
        } else if (media.length > 0) {
            sessionName = `${media.length} Scene${media.length > 1 ? 's' : ''} Reel`;
        }

        // Add timestamp for uniqueness
        const timestamp = new Date().toLocaleString('en-US', {
            month: 'short',
            day: 'numeric',
            hour: 'numeric',
            minute: '2-digit'
        });
        sessionName = `${sessionName} - ${timestamp} `;

        const appState = {
            step,
            creationMode,
            media: serializeUploadedMediaForPersistence(media),
            textToReelTopic,
            userPrompt,
            script,
            selectedVoice: selectedVoiceId,
            selectedStyle,
            videoSpeed,
            targetDuration,
            enableVoiceover,
            enableCaptions,
            visualSettings,
            subtitleSettings,
            audioMix,
            brandKit,
            reelPlan,
            sceneDrafts: serializeSceneDraftsForPersistence(sceneDrafts),
            selectedVoiceId,
        };

        try {
            await saveProjectSession(session.user.id, sessionName, appState);
            setLastAutosave(new Date());
        } catch (e) {
            console.error('Autosave failed:', e);
        }
    };

    const handleFindViralTopics = async (options?: { remixIdea?: ViralTopicIdea; remixNotes?: string; overrideTopic?: string }) => {
        if (isFindingTopics && !options?.remixIdea) return;

        const persona = topicPersona.trim();
        const creatorUrl = topicCreatorUrl.trim();
        const references = referenceLinks;
        const normalizedReferences = references
            .map(withHttpProtocol)
            .map(ref => ref.trim())
            .filter(Boolean);
        const baseTopic = (options?.overrideTopic ?? textToReelTopic).trim();

        if (!persona && !creatorUrl && !baseTopic && normalizedReferences.length === 0) {
            showNotice('Add a persona, channel goal, creator handle, or references before scouting topics.', 'error');
            return;
        }

        if (options?.remixIdea) {
            setRegeneratingIdeaId(options.remixIdea.id);
        } else {
            setShowTopicIdeasPanel(true);
        }

        setIsFindingTopics(true);
        try {
            const productContext = brandKit.productImages?.length
                ? brandKit.productImages.map((img, i) => `Product Image ${i + 1}: ${img.description || img.imagePrompt || 'Product shot'}`)
                : undefined;

            const result = await agentViralTopicFinder({
                persona: persona || undefined,
                creatorProfileUrl: creatorUrl || undefined,
                referenceUrls: normalizedReferences.length ? normalizedReferences : undefined,
                baseTopic: baseTopic || undefined,
                ideaCount: options?.remixIdea ? 1 : topicIdeaCount,
                remixIdea: options?.remixIdea,
                remixNotes: options?.remixNotes,
                productContext,
            });
            const normalizedResult = normalizeViralTopicFinderResult(result);

            if (options?.remixIdea) {
                if (normalizedResult.ideas.length > 0) {
                    const refreshed = { ...normalizedResult.ideas[0], id: options.remixIdea.id };
                    setTopicIdeas(prev => prev.map(idea => idea.id === options.remixIdea!.id ? refreshed : idea));
                    if (editingIdeaId === options.remixIdea.id) {
                        setEditingIdeaText(refreshed.rawTopicLine || refreshed.title || refreshed.hook || '');
                    }
                } else {
                    showNotice('Remix did not return a new idea. Try again.', 'info');
                }
            } else {
                setTopicFinderResult(normalizedResult);
                setTopicIdeas(normalizedResult.ideas || []);
                if (!normalizedResult.ideas?.length) {
                    showNotice('Topic scout completed but no ideas were returned. Try adjusting your inputs.', 'info');
                }
            }
        } catch (e) {
            handleError(e, 'Topic Finder');
        } finally {
            if (options?.remixIdea) {
                setRegeneratingIdeaId(null);
            }
            setIsFindingTopics(false);
        }
    };

    const handleStartIdeaEdit = (idea: ViralTopicIdea) => {
        setEditingIdeaId(idea.id);
        setEditingIdeaText(idea.rawTopicLine || idea.title || idea.hook || '');
    };

    const handleCancelIdeaEdit = () => {
        setEditingIdeaId(null);
        setEditingIdeaText('');
    };

    const handleSaveIdeaEdit = () => {
        if (!editingIdeaId) return;
        const trimmed = editingIdeaText.trim();
        if (!trimmed) {
            showNotice('Edited topic cannot be empty.', 'error');
            return;
        }
        setTopicIdeas(prev => prev.map(idea => idea.id === editingIdeaId ? { ...idea, rawTopicLine: trimmed } : idea));
        setEditingIdeaId(null);
        setEditingIdeaText('');
    };

    const handleUseIdea = (idea: ViralTopicIdea, options?: { autoPlan?: boolean }) => {
        const editedText = editingIdeaId === idea.id && editingIdeaText.trim() ? editingIdeaText.trim() : undefined;
        const topicText = editedText || idea.rawTopicLine || idea.title || idea.hook;
        if (!topicText) {
            showNotice('No topic text available for this idea yet. Try editing first.', 'error');
            return;
        }
        setTextToReelTopic(topicText);
        setSelectedIdeaMeta(idea);
        if (!topicPersona && idea.personaNotes) {
            setTopicPersona(`${idea.personaNotes.tone} ${idea.personaNotes.vibe}`.trim());
        }
        setShowTopicIdeasPanel(false);
        if (options?.autoPlan) {
            handleGeneratePlan(resolveEffectiveTargetDuration(targetDuration));
        }
    };

    const handleRemixIdea = async (idea: ViralTopicIdea, remixNotes?: string) => {
        await handleFindViralTopics({
            remixIdea: idea,
            remixNotes,
            overrideTopic: editingIdeaId === idea.id ? editingIdeaText : undefined
        });
    };


    const handleApproveRef = useRef<() => Promise<void>>();
    useEffect(() => {
        if (!pendingBrandAutoApprove || !reelPlan || step !== AppStep.REVIEW_PLAN) return;
        setPendingBrandAutoApprove(false);
        setTimeout(() => {
            void handleApproveRef.current?.();
        }, 0);
    }, [pendingBrandAutoApprove, reelPlan, step]);

    // Autosave every 2 minutes
    useEffect(() => {
        if (!session?.user) return;

        const autosaveInterval = setInterval(() => {
            performAutosave();
        }, 2 * 60 * 1000); // 2 minutes

        return () => clearInterval(autosaveInterval);
    }, [session?.user, step, creationMode, script, media, sceneDrafts, reelPlan, textToReelTopic, userPrompt, selectedVoiceId, visualSettings, subtitleSettings, audioMix, brandKit, enableVoiceover, enableCaptions]);
    const handleStartWorkflow = (mode: CreationMode) => {
        setCreationMode(mode);
        setStep(mode === CreationMode.TEXT_TO_REEL ? AppStep.TOPIC_INPUT : AppStep.UPLOAD);
    };

    const showNotice = (message: string, type: 'error' | 'info' | 'warning' = 'info') => {
        setNotice({ type, message });
        if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
        noticeTimeoutRef.current = window.setTimeout(() => setNotice(null), 6000);
    };

    const invalidateGeneratedVoicePreview = useCallback((message?: string) => {
        generatedVoiceSyncSignatureRef.current = '';
        setAudioBuffer(null);
        setAudioSegmentDurations([]);
        if (message) {
            showNotice(message, 'info');
        }
    }, []);

    useEffect(() => {
        if (!audioBuffer || !generatedVoiceSyncSignatureRef.current) return;
        if (voiceSyncSignature === generatedVoiceSyncSignatureRef.current) return;
        invalidateGeneratedVoicePreview('Narration was cleared because the script or voice selection changed. Regenerate voice to keep everything in sync.');
    }, [audioBuffer, invalidateGeneratedVoicePreview, voiceSyncSignature]);

    const enrichMediaPresentation = useCallback(async (
        items: UploadedMedia[],
        options?: { sourceHint?: string }
    ): Promise<UploadedMedia[]> => {
        return Promise.all(items.map(async (item) => {
            if (item.type !== 'image' || !item.base64) return item;
            try {
                const presentation = await analyzeImagePresentation(item, {
                    sceneText: item.description || item.imagePrompt,
                    sourceHint: options?.sourceHint || item.assetOrigin || 'media_upload'
                });
                return { ...item, ...presentation };
            } catch (error) {
                console.warn('Failed to enrich media presentation', error);
                return item;
            }
        }));
    }, []);

    const handleStudioMediaUpdate = useCallback((updatedMedia: UploadedMedia[]) => {
        const normalized = normalizeMediaIdentity(updatedMedia);
        setSceneDrafts(prev => reconcileSceneDraftsWithMedia(prev, normalized));
    }, []);

    const clearWorkspaceMedia = useCallback(() => {
        setMedia([]);
        setSceneDrafts([]);
        setSlideDurations([]);
        setAudioSegmentDurations([]);
        setAudioBuffer(null);
        setScript(null);
        sceneAudioCacheRef.current = {};
    }, []);

    const handleBulkUpdateClipDuration = useCallback((
        mode: 'all' | 'fromHere' | 'equalSplitAll' | 'equalSplitFromHere',
        index: number,
        duration: number,
    ) => {
        let flaggedStale = false;
        const effectiveTarget = resolveEffectiveTargetDuration(targetDuration);

        setSceneDrafts(prev => {
            if (mode === 'equalSplitAll' || mode === 'equalSplitFromHere') {
                const start = mode === 'equalSplitFromHere' ? Math.max(0, index) : 0;
                const keptSum = prev.slice(0, start).reduce(
                    (sum, draft) => sum + clampSceneDuration(draft.requestedDurationSec),
                    0,
                );
                const count = Math.max(1, prev.length - start);
                const budget = effectiveTarget > 0
                    ? Math.max(0.7 * count, effectiveTarget - keptSum)
                    : sumSceneDurations(prev.slice(start));
                const splits = equalSplitDurations(count, budget);
                return prev.map((draft, draftIndex) => {
                    if (draftIndex < start) return draft;
                    const nextDraft = applySceneDurationEdit(draft, splits[draftIndex - start] ?? draft.requestedDurationSec);
                    flaggedStale = flaggedStale || nextDraft.generationStatus.voice === 'stale';
                    return nextDraft;
                });
            }

            return prev.map((draft, draftIndex) => {
                const shouldUpdate = mode === 'all' || draftIndex >= index;
                if (!shouldUpdate) return draft;
                const nextDraft = applySceneDurationEdit(draft, duration);
                flaggedStale = flaggedStale || nextDraft.generationStatus.voice === 'stale';
                return nextDraft;
            });
        });
        if (flaggedStale) {
            showNotice('Some scenes are now shorter than their voiceover. Rewrite to fit or regenerate voice to resync.', 'info');
        }
    }, [targetDuration]);

    const pacingScenes = useMemo(
        () => buildPacingScenesViewModel(sceneDrafts),
        [sceneDrafts],
    );

    const handleFitDurationsToTarget = useCallback(() => {
        const effectiveTarget = resolveEffectiveTargetDuration(targetDuration)
            || sumSceneDurations(sceneDrafts)
            || 30;
        let flaggedStale = false;
        setSceneDrafts(prev => {
            const allocated = rippleUnlockedDurationsToTarget(
                prev.map((draft) => ({
                    pacingRole: draft.pacingRole,
                    scriptGuidance: draft.voiceoverText || draft.onScreenText || draft.visualDescription,
                    requestedDurationSec: draft.requestedDurationSec,
                    pacingLocked: draft.pacingLocked,
                })),
                effectiveTarget,
            );
            return prev.map((draft, index) => {
                if (draft.pacingLocked) return draft;
                const nextDraft = applySceneDurationEdit(draft, allocated[index] ?? draft.requestedDurationSec);
                flaggedStale = flaggedStale || nextDraft.generationStatus.voice === 'stale';
                return nextDraft;
            });
        });
        showNotice(`Timeline fit to ${effectiveTarget}s target (locked clips kept).`, 'info');
        if (flaggedStale) {
            showNotice('Some voices no longer fit. Regenerate voice to tighten pacing.', 'info');
        }
    }, [targetDuration, sceneDrafts]);

    const handleFitTimelineToMeasuredVoice = useCallback(() => {
        const effectiveTarget = resolveEffectiveTargetDuration(targetDuration)
            || sumSceneDurations(sceneDrafts)
            || 30;
        const hasVoice = sceneDrafts.some((draft) => (draft.voiceAsset?.durationSec || 0) > 0.05);
        if (!hasVoice) {
            showNotice('Generate voice first, then fit the timeline to it.', 'info');
            return;
        }

        const assessment = assessMeasuredNarrationFeasibility(
            sceneDrafts.map((draft) => ({
                requestedDurationSec: draft.requestedDurationSec,
                sceneNumber: draft.sceneNumber,
                pacingRole: draft.pacingRole,
                pacingLocked: draft.pacingLocked,
                scriptGuidance: draft.voiceoverText || draft.onScreenText || draft.visualDescription,
            })),
            sceneDrafts.map((draft) => draft.voiceAsset?.durationSec || 0),
            effectiveTarget,
        );
        const reconciled = assessment.reconciledSlots;
        setSceneDrafts((prev) => prev.map((draft, index) => {
            return applySceneDurationEdit(draft, reconciled[index] ?? draft.requestedDurationSec);
        }));
        if (assessment.feasibility === 'impossible') {
            const message = assessment.constraint === 'locked_constraints'
                ? 'Locked scene timing conflicts with measured narration. Unlock the affected scenes before fitting.'
                : `Clean narration needs at least ${assessment.measuredMinimumSec.toFixed(1)}s. Shorten the offending lines and regenerate voice, or raise the ${effectiveTarget}s target.`;
            showNotice(message, 'error');
        } else {
            showNotice(`Timeline fitted to clean voice at ${effectiveTarget}s.`, 'info');
        }
    }, [targetDuration, sceneDrafts]);

    // Heal extreme VO→slot mismatches when opening Clip Studio (existing sessions).
    const healedVoiceTimelineSigRef = useRef('');
    useEffect(() => {
        if (step !== AppStep.VIDEO_EXTENSION) return;
        const voiceSig = sceneDrafts
            .map((draft) => `${draft.id}:${Number(draft.voiceAsset?.durationSec || 0).toFixed(2)}`)
            .join('|');
        if (!voiceSig || voiceSig === healedVoiceTimelineSigRef.current) return;
        if (!sceneDrafts.some((draft) => (draft.voiceAsset?.durationSec || 0) > 0.05)) return;
        if (!buildPacingScenesViewModel(sceneDrafts).some((meter) => meter.status === 'extreme')) {
            healedVoiceTimelineSigRef.current = voiceSig;
            return;
        }

        healedVoiceTimelineSigRef.current = voiceSig;
        const effectiveTarget = resolveEffectiveTargetDuration(targetDuration)
            || sumSceneDurations(sceneDrafts)
            || 30;
        setSceneDrafts((prev) => {
            const reconciled = reconcileTimelineToMeasuredVoice(
                prev.map((draft) => ({
                    requestedDurationSec: draft.requestedDurationSec,
                    pacingRole: draft.pacingRole,
                    pacingLocked: draft.pacingLocked,
                    scriptGuidance: draft.voiceoverText || draft.onScreenText || draft.visualDescription,
                })),
                prev.map((draft) => draft.voiceAsset?.durationSec || 0),
                effectiveTarget,
            );
            const changed = reconciled.some(
                (value, index) => Math.abs(value - (prev[index]?.requestedDurationSec || 0)) > 0.15,
            );
            if (!changed) return prev;
            return prev.map((draft, index) => {
                return applySceneDurationEdit(draft, reconciled[index] ?? draft.requestedDurationSec);
            });
        });
    }, [step, sceneDrafts, targetDuration]);

    const handleSetClipPacingRole = useCallback((index: number, role: ScenePacingRole) => {
        setSceneDrafts(prev => prev.map((draft, draftIndex) => (
            draftIndex === index ? { ...draft, pacingRole: role } : draft
        )));
    }, []);

    const handleToggleClipPacingLock = useCallback((index: number) => {
        setSceneDrafts(prev => prev.map((draft, draftIndex) => (
            draftIndex === index ? { ...draft, pacingLocked: !draft.pacingLocked } : draft
        )));
    }, []);

    const handleRippleDurationChange = useCallback((index: number, duration: number) => {
        const effectiveTarget = resolveEffectiveTargetDuration(targetDuration);
        let flaggedStale = false;
        setSceneDrafts(prev => {
            if (!(effectiveTarget > 0) || prev[index]?.pacingLocked) {
                return prev.map((draft, draftIndex) => {
                    if (draftIndex !== index) return draft;
                    const nextDraft = applySceneDurationEdit(draft, duration);
                    flaggedStale = nextDraft.generationStatus.voice === 'stale';
                    return nextDraft;
                });
            }

            const allocated = rippleUnlockedDurationsToTarget(
                prev.map((draft) => ({
                    pacingRole: draft.pacingRole,
                    scriptGuidance: draft.voiceoverText || draft.onScreenText || draft.visualDescription,
                    requestedDurationSec: draft.requestedDurationSec,
                    pacingLocked: draft.pacingLocked,
                })),
                effectiveTarget,
                { editedIndex: index, nextDuration: duration, keepEditedFixed: true },
            );

            return prev.map((draft, draftIndex) => {
                if (draft.pacingLocked && draftIndex !== index) return draft;
                const nextDraft = applySceneDurationEdit(draft, allocated[draftIndex] ?? draft.requestedDurationSec);
                flaggedStale = flaggedStale || nextDraft.generationStatus.voice === 'stale';
                return nextDraft;
            });
        });
        if (flaggedStale) {
            showNotice('Some scenes are now shorter than their voiceover. Rewrite to fit or regenerate voice to resync.', 'info');
        }
    }, [targetDuration]);

    const handleApplyRolePreset = useCallback((index: number, role: 'hook' | 'body' | 'cta') => {
        const effectiveTarget = resolveEffectiveTargetDuration(targetDuration)
            || sumSceneDurations(sceneDrafts)
            || 30;
        const preset = rolePresetDuration(role, effectiveTarget, Math.max(1, sceneDrafts.length));
        let flaggedStale = false;
        setSceneDrafts(prev => prev.map((draft, draftIndex) => {
            if (draftIndex !== index) return draft;
            const withRole = { ...draft, pacingRole: role as ScenePacingRole };
            const nextDraft = applySceneDurationEdit(withRole, preset);
            flaggedStale = nextDraft.generationStatus.voice === 'stale';
            return nextDraft;
        }));
        if (flaggedStale) {
            showNotice('That scene is now shorter than its generated voice. Rewrite to fit or regenerate voice.', 'info');
        }
    }, [targetDuration, sceneDrafts]);

    const refreshBrandAssetCatalog = useCallback(async (nextBrandKit: BrandKit) => {
        const hasAssets = Boolean(nextBrandKit.logo || nextBrandKit.productImages?.length);
        if (!hasAssets) {
            setBrandAssetCatalog([]);
            return;
        }

        try {
            const catalog = await catalogBrandAssets(nextBrandKit);
            setBrandAssetCatalog(catalog);
        } catch (error) {
            console.warn('Failed to refresh brand asset catalog', error);
        }
    }, []);

    const logReelHistory = useCallback(async (
        status: 'plan_saved' | 'assets_generated' | 'error',
        options?: { planOverride?: ReelPlan | null; promptOverride?: string; scriptOverride?: ReelScript | null; metadata?: Record<string, any>; modeOverride?: CreationMode | string }
    ) => {
        if (!session?.user) return;
        try {
            const persistedMedia = serializeUploadedMediaForPersistence(media);
            const persistedDrafts = serializeSceneDraftsForPersistence(sceneDrafts);
            await saveReelHistoryEntry({
                userId: session.user.id,
                status,
                mode: options?.modeOverride || creationMode || 'unknown',
                prompt: options?.promptOverride || userPrompt,
                reelPlan: options?.planOverride ?? reelPlan,
                script: options?.scriptOverride ?? script,
                metadata: {
                    ...options?.metadata,
                    media: persistedMedia,
                    sceneDrafts: persistedDrafts,
                }
            });
            await refreshHistory();
        } catch (err) {
            console.warn('Failed to log reel history', err);
        }
    }, [session?.user, creationMode, media, reelPlan, sceneDrafts, script, userPrompt, refreshHistory]);

    const handleError = (error: unknown, context?: string) => {
        console.error(context ? `${context} error` : 'Unexpected error', error);
        const message = error instanceof Error ? error.message : 'Something went wrong.';
        showNotice(`${context ? `${context}: ` : ''}${message} `, 'error');
    };

    useEffect(() => () => {
        if (noticeTimeoutRef.current) window.clearTimeout(noticeTimeoutRef.current);
    }, []);

    const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const uploaded: VisualAsset[] = [];
        const files = Array.from(e.target.files as FileList);
        for (const file of files) {
            const { base64, mimeType } = await processCompatibleBase64(file);
            uploaded.push({
                file,
                base64,
                mimeType,
                previewUrl: URL.createObjectURL(file),
                assetId: getSceneDraftId(),
                description: file.name,
                shotType: 'logo',
                productIdentity: brandKit.visualSignature || brandKit.websiteUrl || 'Brand logo',
            });
        }
        let nextBrandKit: BrandKit | null = null;
        setBrandKit(prev => {
            const updatedLogos = [...(prev.logos || []), ...uploaded];
            nextBrandKit = {
                ...prev,
                logos: updatedLogos,
                logo: updatedLogos[0]
            };
            return nextBrandKit;
        });
        if (nextBrandKit) {
            await refreshBrandAssetCatalog(nextBrandKit);
        }
        e.target.value = '';
    };

    const handleProductUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const newProds: VisualAsset[] = [];
        const files = Array.from(e.target.files as FileList);
        for (const file of files) {
            const { base64, mimeType } = await processCompatibleBase64(file);
            newProds.push({
                file,
                base64,
                mimeType,
                previewUrl: URL.createObjectURL(file),
                assetId: getSceneDraftId(),
                description: file.name,
                shotType: 'packshot',
                productIdentity: brandKit.visualSignature || 'Uploaded brand product',
            });
        }
        let nextBrandKit: BrandKit | null = null;
        setBrandKit(prev => {
            nextBrandKit = { ...prev, productImages: [...(prev.productImages || []), ...newProds] };
            return nextBrandKit;
        });
        if (nextBrandKit) {
            await refreshBrandAssetCatalog(nextBrandKit);
        }
        e.target.value = '';
    };

    const handleRemoveLogo = (index: number) => {
        let nextBrandKit: BrandKit | null = null;
        setBrandKit(prev => {
            const current = [...(prev.logos || (prev.logo ? [prev.logo] : []))];
            if (index < 0 || index >= current.length) return prev;
            current.splice(index, 1);
            nextBrandKit = {
                ...prev,
                logos: current,
                logo: current[0]
            };
            return nextBrandKit;
        });
        if (nextBrandKit) {
            void refreshBrandAssetCatalog(nextBrandKit);
        }
    };

    const handleRemoveProductImage = (index: number) => {
        let nextBrandKit: BrandKit | null = null;
        setBrandKit(prev => {
            if (!prev.productImages) return prev;
            const updated = [...prev.productImages];
            if (index < 0 || index >= updated.length) return prev;
            updated.splice(index, 1);
            nextBrandKit = { ...prev, productImages: updated };
            return nextBrandKit;
        });
        if (nextBrandKit) {
            void refreshBrandAssetCatalog(nextBrandKit);
        }
    };

    const handleWebsiteChange = (index: number, value: string) => {
        setBrandKit(prev => {
            const current = [...(prev.websiteUrls?.length ? prev.websiteUrls : (prev.websiteUrl ? [prev.websiteUrl] : []))];
            if (index >= current.length) {
                current.push(value);
            } else {
                current[index] = value;
            }
            return { ...prev, websiteUrls: current, websiteUrl: current[0] || undefined };
        });
    };

    const handleAddWebsite = () => {
        setBrandKit(prev => {
            const current = [...(prev.websiteUrls?.length ? prev.websiteUrls : (prev.websiteUrl ? [prev.websiteUrl] : []))];
            current.push('');
            return { ...prev, websiteUrls: current, websiteUrl: current[0] || undefined };
        });
    };

    const handleRemoveWebsite = (index: number) => {
        setBrandKit(prev => {
            const current = [...(prev.websiteUrls?.length ? prev.websiteUrls : (prev.websiteUrl ? [prev.websiteUrl] : []))];
            if (index < 0 || index >= current.length) return prev;
            current.splice(index, 1);
            return { ...prev, websiteUrls: current, websiteUrl: current[0] || undefined };
        });
    };

    const handleVoicePreview = async (voice: VoiceOption, e: React.MouseEvent) => {
        e.stopPropagation();
        if (voice.provider !== 'google' && !hasConfiguredGeminiApiKey()) {
            showNotice('Voice preview is blocked: add a real Gemini API key to .env.local and restart the dev server.', 'error');
            return;
        }
        if (playingVoicePreview === voice.id) {
            if (voicePreviewSource.current) {
                try { voicePreviewSource.current.stop(); } catch { }
            }
            voicePreviewSource.current = null;
            if (voicePreviewContextRef.current && voicePreviewContextRef.current.state !== 'closed') {
                await voicePreviewContextRef.current.close().catch(() => undefined);
            }
            voicePreviewContextRef.current = null;
            setPlayingVoicePreview(null);
            return;
        }

        const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
        if (!AudioContextCtor) {
            showNotice('Audio preview is not supported in this browser.', 'error');
            return;
        }

        try {
            if (voicePreviewSource.current) {
                try { voicePreviewSource.current.stop(); } catch { }
                voicePreviewSource.current = null;
            }
            if (voicePreviewContextRef.current && voicePreviewContextRef.current.state !== 'closed') {
                await voicePreviewContextRef.current.close().catch(() => undefined);
            }

            const ctx = new AudioContextCtor({ sampleRate: 24000 });
            voicePreviewContextRef.current = ctx;
            setPlayingVoicePreview(voice.id);
            const b64 = await generateVoiceover(`Hi, I'm ${voice.label}. Let's create something viral.`, voice);
            const buffer = await decodeAudioData(b64, ctx);
            if (!buffer || buffer.length <= 1 || buffer.duration <= 0.02) {
                throw new Error('Voice preview returned an empty audio buffer.');
            }
            if (ctx.state === 'suspended') {
                await ctx.resume();
            }
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination);
            src.onended = () => {
                setPlayingVoicePreview(null);
                voicePreviewSource.current = null;
            };
            src.start();
            voicePreviewSource.current = src;
        } catch (e) {
            console.error(e);
            setPlayingVoicePreview(null);
            showNotice('Voice preview failed to play.', 'error');
            if (voicePreviewContextRef.current && voicePreviewContextRef.current.state !== 'closed') {
                await voicePreviewContextRef.current.close().catch(() => undefined);
            }
            voicePreviewContextRef.current = null;
            voicePreviewSource.current = null;
        }
    };

    const handleMediaUpload = (items: UploadedMedia[]) => {
        const normalizedItems = normalizeMediaIdentity(items);
        setMedia(normalizedItems);
        setSlideDurations(normalizedItems.map(deriveClipDuration));
        if (normalizedItems.length === 0) {
            setSceneDrafts([]);
            return;
        }
        if (!script && normalizedItems.length) {
            const stub: ReelScript = {
                title: 'Imported Reel',
                hook: '',
                body: '',
                callToAction: '',
                fullText: normalizedItems.map((_, idx) => `Scene ${idx + 1}: add your narration or caption.`).join('\n'),
                segments: normalizedItems.map((_, idx) => `Scene ${idx + 1}: add your narration or caption.`),
            };
            setScript(stub);
            setSceneDrafts(createSceneDraftsFromMediaAndScript(normalizedItems, stub));
            void enrichMediaPresentation(normalizedItems, { sourceHint: 'media_upload' }).then((enhancedItems) => {
                setMedia(enhancedItems);
                setSlideDurations(enhancedItems.map(deriveClipDuration));
                setSceneDrafts(createSceneDraftsFromMediaAndScript(enhancedItems, stub));
            });
            return;
        }
        setSceneDrafts(createSceneDraftsFromMediaAndScript(normalizedItems, script));
        void enrichMediaPresentation(normalizedItems, { sourceHint: 'media_upload' }).then((enhancedItems) => {
            setMedia(enhancedItems);
            setSlideDurations(enhancedItems.map(deriveClipDuration));
            setSceneDrafts(createSceneDraftsFromMediaAndScript(enhancedItems, script));
        });
    };

    // Standalone Video Editor upload handler
    const handleVideoEditorUpload = async (files: File[]) => {
        if (!files.length) return;

        const mediaItems: UploadedMedia[] = await Promise.all(files.map(async (file) => {
            const previewUrl = URL.createObjectURL(file);
            const isVideo = file.type.startsWith('video/');

            let duration = 3; // default for images
            if (isVideo) {
                // Get video duration
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

            return {
                file,
                previewUrl,
                thumbnailUrl: previewUrl,
                type: isVideo ? 'video' : 'image',
                mimeType: file.type,
                duration,
                sceneId: getSceneDraftId(),
                assetOrigin: isVideo ? 'user_upload' : 'generated',
            } as UploadedMedia;
        }));

        const normalizedMedia = normalizeMediaIdentity(mediaItems);
        setMedia(normalizedMedia);
        setSlideDurations(normalizedMedia.map(deriveClipDuration));
        setSceneDrafts(createSceneDraftsFromMediaAndScript(normalizedMedia, script));
        void enrichMediaPresentation(normalizedMedia, { sourceHint: 'video_editor_upload' }).then((enhancedItems) => {
            setMedia(enhancedItems);
            setSlideDurations(enhancedItems.map(deriveClipDuration));
            setSceneDrafts(createSceneDraftsFromMediaAndScript(enhancedItems, script));
        });
    };

    const handleVoiceRecordingComplete = async (blob: Blob) => {
        const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
        try {
            const buffer = await blobToAudioBuffer(blob, ctx);
            setAudioBuffer(buffer);
            const totalDuration = buffer.duration;
            const avgDuration = totalDuration / Math.max(1, media.length || 1);
            const durations = media.length ? new Array(media.length).fill(avgDuration) : [Math.max(0.7, totalDuration || 3)];

            setAudioSegmentDurations(durations);
            setSlideDurations(durations);
            setSelectedVoiceId('Custom');
            setSceneDrafts(prev => prev.map((draft, index) => ({
                ...draft,
                requestedDurationSec: durations[index] || draft.requestedDurationSec,
                resolvedDurationSec: durations[index] || draft.resolvedDurationSec,
                generationStatus: {
                    ...draft.generationStatus,
                    voice: 'clean',
                },
            })));
            setShowVoiceRecorder(false);
            setStep(AppStep.VIDEO_EXTENSION);
        } catch (error) {
            console.error('Failed to process audio recording', error);
            showNotice('Failed to process audio recording.', 'error');
        }
    };

    const handleSkipToEditor = () => {
        if (!media.length) {
            showNotice('Upload at least one video to edit.', 'error');
            return;
        }

        const placeholderSegments = media.map((_, idx) => script?.segments[idx] || `Scene ${idx + 1}: add your narration or caption.`);

        if (script) {
            const nextScript = {
                ...script,
                segments: placeholderSegments,
                fullText: placeholderSegments.join('\n'),
            };
            setScript(nextScript);
            setSceneDrafts(createSceneDraftsFromMediaAndScript(media, nextScript));
        } else {
            const nextScript = {
                title: 'Imported Reel',
                hook: '',
                body: '',
                callToAction: '',
                fullText: placeholderSegments.join('\n'),
                segments: placeholderSegments,
            };
            setScript(nextScript);
            setSceneDrafts(createSceneDraftsFromMediaAndScript(media, nextScript));
        }

        setSlideDurations(media.map(deriveClipDuration));
        setStep(AppStep.ANALYZE_SCRIPT);
    };

    const handleInitialAnalysis = async () => {
        console.log('[App] handleInitialAnalysis started', { mediaLength: media.length, userPrompt });
        let promptToUse = userPrompt;
        if (media.length === 0) {
            console.warn('[App] No media to analyze');
            return;
        }

        // Gemini does not support SVG inputs; filter them out before analysis
        const supportedMedia = media.filter(item => item.mimeType !== 'image/svg+xml');
        if (supportedMedia.length === 0) {
            console.warn('[App] All media are SVG; skipping Gemini analysis');
            showNotice('SVG images are not supported for AI analysis. Please upload JPG/PNG/WEBP or skip to manual editor.', 'error');
            setStep(AppStep.UPLOAD);
            return;
        }

        setStep(AppStep.GENERATING_ASSETS);
        setGenerationStep(1);
        setGenerationStatusText('Analyzing your media...');
        try {
            console.log('[App] Starting analysis...');
            if (!promptToUse || !promptToUse.trim()) {
                setIsAnalyzingContext(true);
                promptToUse = await analyzeMediaContext(supportedMedia);
                setUserPrompt(promptToUse);
                setIsAnalyzingContext(false);
            }
            setGenerationStep(2);
            setGenerationStatusText('Generating viral script...');
            setScript(null);
            const genScript = await analyzeMediaAndCreateScript(supportedMedia, promptToUse, selectedStyle, musicVibeDescription);
            setScript(genScript);
            setGenerationStep(3);
            setGenerationStatusText('Finalizing...');

            let defaultFont = 'Inter';
            let defaultColor = brandKit.hexColor || '#FFFFFF';
            if (selectedStyle === ScriptStyle.Luxury) defaultFont = 'Playfair Display';
            else if (selectedStyle === ScriptStyle.GenZ) defaultFont = 'Montserrat';
            else if (selectedStyle === ScriptStyle.Funny) defaultFont = 'Bangers';
            else if (selectedStyle === ScriptStyle.Emotional) defaultFont = 'Merriweather';

            setSubtitleSettings(prev => ({ ...prev, fontFamily: defaultFont, color: defaultColor }));
            if (genScript.suggestedVisuals) setVisualSettings(prev => ({ ...prev, ...genScript.suggestedVisuals }));
            if (genScript.musicSuggestion) setCustomMusicPrompt(genScript.musicSuggestion.description);
            setStep(AppStep.ANALYZE_SCRIPT);
        } catch (e) {
            console.error('[App] Analysis failed:', e);
            handleError(e, 'Initial Analysis');
            setStep(AppStep.UPLOAD);
        }
    };

    const handleGeneratePlan = async (durationOverride?: number, skipRefiner = false, feedback?: string) => {
        const effectiveDuration = resolveEffectiveTargetDuration(
            typeof durationOverride === 'number' ? durationOverride : targetDuration,
        );
        if (!textToReelTopic.trim()) return;
        setStep(AppStep.GENERATING_ASSETS);
        setGenerationStep(1);
        setGenerationStatusText('Refining intent...');

        try {
            const refinerContext: TopicRefinerContext = {
                persona: topicPersona.trim() || undefined,
                creatorProfileUrl: topicCreatorUrl.trim() || undefined,
                referenceUrls: referenceLinks.length ? referenceLinks.map(withHttpProtocol).map(r => r.trim()).filter(Boolean) : undefined,
                ideaHook: selectedIdeaMeta?.hook,
                ideaAngle: selectedIdeaMeta?.angle,
                ideaTrendReason: selectedIdeaMeta?.trendReason,
                ideaPersonaNotes: selectedIdeaMeta?.personaNotes,
            };
            // Skip topic refiner on regenerations — topic is already refined;
            // running it again on its own output + appended feedback degrades quality.
            // Feedback is applied for this run only — never mutate the canonical topic.
            const topicSeed = feedback?.trim()
                ? `${textToReelTopic.trim()}. USER FEEDBACK: ${feedback.trim()}`
                : textToReelTopic;
            let refinedTopic = topicSeed;
            if (!skipRefiner) {
                refinedTopic = await withTimeout(agentTopicRefiner(topicSeed, refinerContext), 30000, 'Topic Refiner', topicSeed);
            }
            setGenerationStep(2);
            setGenerationStatusText('Researching trends & facts...');

            // Single merged research call — replaces 3 separate parallel Google Search calls
            const { trendReport, researchReport, viralReport } = await withTimeout(
                agentResearch(refinedTopic),
                45000,
                'Research',
            );

            setGenerationStep(3);
            setGenerationStatusText('Building & reviewing your reel plan...');
            
            const enhancedBrandKit = { ...brandKit };
            const hasBrandAssets = brandKit.logo || (brandKit.productImages && brandKit.productImages.length > 0);
            if (hasBrandAssets) {
                // Fetch catalog and aesthetic analysis in parallel instead of sequentially
                const catalogPromise = brandKit.assetCatalog?.length ? Promise.resolve(brandKit.assetCatalog) : catalogBrandAssets(brandKit);
                const analysisPromise = brandKit.aestheticAnalysis ? Promise.resolve(brandKit.aestheticAnalysis) : analyzeBrandAesthetics(brandKit);
                
                const [catalog, analysis] = await Promise.all([catalogPromise, analysisPromise]);
                
                enhancedBrandKit.assetCatalog = catalog;
                enhancedBrandKit.aestheticAnalysis = analysis;
                setBrandAssetCatalog(catalog);
                
                if (catalog.length > 0) {
                    enhancedBrandKit.aestheticAnalysis = `${analysis}\nAsset Catalog: ${catalog.map(asset => `Asset ${asset.imageIndex ?? 0} (${asset.assetId}): ${asset.semanticDescription}. Identity: ${asset.productIdentity}. Shot: ${asset.shotType}.`).join(' ')}`;
                }
            }

            // Show research/options summary before plan generation
            setTopicFinderResult(null);
            setTopicIdeas([]);

            const planContext: ReelPlanContext = {
                persona: topicPersona.trim() || undefined,
                creatorProfileUrl: topicCreatorUrl.trim() || undefined,
                referenceUrls: referenceLinks.length ? referenceLinks.map(withHttpProtocol).map(r => r.trim()).filter(Boolean) : undefined,
                ideaHook: selectedIdeaMeta?.hook,
                ideaAngle: selectedIdeaMeta?.angle,
                ideaTrendReason: selectedIdeaMeta?.trendReason,
                ideaCallToAction: selectedIdeaMeta?.callToAction,
                ideaHashtagStack: selectedIdeaMeta?.hashtagStack,
                ideaPersonaNotes: selectedIdeaMeta?.personaNotes,
                scriptStyle: selectedStyle,
            };
            const plan = await generateReelPlan(
                refinedTopic,
                trendReport,
                researchReport,
                viralReport,
                enhancedBrandKit.aestheticAnalysis,
                musicVibeDescription,
                effectiveDuration,
                planContext,
                ecoMode
            );
            setReelPlan(plan);
            setUserPrompt(`Topic: ${refinedTopic}.Vibe: ${plan.vibe}.Hooks: ${trendReport.viralHooks.join(', ')} `);
            setIsRegenerating(false);
            setStep(AppStep.REVIEW_PLAN);
            logReelHistory('plan_saved', {
                planOverride: plan,
                promptOverride: refinedTopic,
                metadata: {
                    mode: creationMode,
                    trendHooks: trendReport.viralHooks,
                    vibe: plan.vibe
                }
            });
        } catch (e) {
            setIsRegenerating(false);
            handleError(e, 'Plan Generation');
            logReelHistory('error', {
                metadata: { stage: 'plan_generation', error: (e as Error)?.message }
            });
            setStep(AppStep.TOPIC_INPUT);
            setGenerationStatusText('Plan generation failed');
        }
    };

    async function handleScriptGeneration(mediaOverride?: UploadedMedia[], draftOverride?: SceneDraft[]) {
        setIsScriptLoading(true); setStep(AppStep.ANALYZE_SCRIPT);
        const mediaToUse = normalizeMediaIdentity(mediaOverride || media);

        // If the incoming drafts already have voiceover text (promoted from plan scriptGuidance),
        // skip the full LLM script generation call — the plan already wrote per-scene guidance.
        const draftsHaveVoiceover = draftOverride && draftOverride.length > 0
            && draftOverride.some(d => (d.voiceoverText || d.onScreenText || '').trim().length > 0);

        if (draftsHaveVoiceover && draftOverride) {
            const derivedScript = deriveScriptFromSceneDrafts(null, draftOverride);
            setScript(derivedScript);
            setSceneDrafts(draftOverride);
            setIsScriptLoading(false);
            let defaultFont = 'Inter'; const defaultColor = brandKit.hexColor || '#FFFFFF';
            if (selectedStyle === ScriptStyle.Luxury) defaultFont = 'Playfair Display';
            else if (selectedStyle === ScriptStyle.GenZ) defaultFont = 'Montserrat';
            setSubtitleSettings(prev => ({ ...prev, fontFamily: defaultFont, color: defaultColor }));
            return;
        }

        setScript(null);
        try {
            const genScript = await analyzeMediaAndCreateScript(mediaToUse, userPrompt, selectedStyle, musicVibeDescription, ecoMode);
            const baseDrafts = draftOverride?.length === mediaToUse.length
                ? draftOverride
                : sceneDrafts.length === mediaToUse.length
                    ? sceneDrafts
                    : createSceneDraftsFromMediaAndScript(mediaToUse, genScript);
            const mergedDrafts = mergeScriptIntoSceneDrafts(baseDrafts, genScript);
            setSceneDrafts(mergedDrafts);
            setScript(deriveScriptFromSceneDrafts(genScript, mergedDrafts));
            setIsScriptLoading(false);
            let defaultFont = 'Inter'; const defaultColor = brandKit.hexColor || '#FFFFFF';
            if (selectedStyle === ScriptStyle.Luxury) defaultFont = 'Playfair Display';
            else if (selectedStyle === ScriptStyle.GenZ) defaultFont = 'Montserrat';
            setSubtitleSettings(prev => ({ ...prev, fontFamily: defaultFont, color: defaultColor }));
            if (genScript.suggestedVisuals) setVisualSettings(prev => ({ ...prev, ...genScript.suggestedVisuals }));
            if (genScript.musicSuggestion) setCustomMusicPrompt(genScript.musicSuggestion.description);
        } catch (e) {
            setIsScriptLoading(false);
            handleError(e, 'Script Generation');
            const fallbackDrafts = draftOverride?.length === mediaToUse.length
                ? draftOverride
                : sceneDrafts.length === mediaToUse.length
                    ? sceneDrafts
                    : createSceneDraftsFromMediaAndScript(mediaToUse, null);
            setSceneDrafts(fallbackDrafts);
            setMedia(mediaToUse);
            setSlideDurations(deriveSlideDurationsFromSceneDrafts(fallbackDrafts));
            setScript(deriveScriptFromSceneDrafts(null, fallbackDrafts));
            showNotice('AI script generation failed. Loaded the approved scenes into Script Studio so you can keep editing.', 'info');
            setStep(AppStep.ANALYZE_SCRIPT);
        }
    }

    const handleSmartRewrite = async (index: number, instruction: string, dispatch?: any) => {
        const targetDraft = sceneDrafts[index];
        if (!targetDraft) return;
        const currentText = (
            targetDraft.onScreenText ||
            targetDraft.voiceoverText ||
            script?.segmentPlans?.[index]?.onScreenText ||
            script?.segmentPlans?.[index]?.voiceoverText ||
            script?.segments?.[index] ||
            ''
        ).trim();
        if (!currentText) {
            showNotice('No script text found for this scene yet.', 'error');
            return;
        }

        console.log('[App] handleSmartRewrite', { index, instruction, currentText });
        if (dispatch) dispatch({ type: 'SET_REWRITING_INDEX', payload: index });
        try {
            const prevDraft = sceneDrafts[index - 1];
            const nextDraft = sceneDrafts[index + 1];
            const prevText = prevDraft ? (prevDraft.voiceoverText || prevDraft.onScreenText || '').trim() : undefined;
            const nextText = nextDraft ? (nextDraft.voiceoverText || nextDraft.onScreenText || '').trim() : undefined;

            const newText = await rewriteScriptSegment(
                currentText,
                targetDraft.visualDescription || media[index]?.description || '',
                instruction,
                prevText,
                nextText,
                { targetDurationSec: targetDraft.requestedDurationSec },
            );
            console.log('[App] Rewrite result:', newText);
            const currentPrompt = (targetDraft.imagePrompt || '').trim();
            if (
                (currentPrompt && newText.trim() === currentPrompt) ||
                isBrokenRewriteOutput(newText) ||
                (isLikelyVisualPromptText(newText) && !isLikelyVisualPromptText(currentText))
            ) {
                showNotice('Rewrite returned visual direction instead of spoken script. Keeping the current scene text.', 'info');
                if (dispatch) dispatch({ type: 'SET_REWRITING_INDEX', payload: null });
                return;
            }
            if (newText.trim() === currentText.trim()) {
                showNotice('Rewrite did not produce a safe full line. Keeping the current scene text.', 'info');
            }
            invalidateGeneratedVoicePreview();
            setSceneDrafts(prev => prev.map((draft, draftIndex) =>
                draftIndex === index ? applySceneTextEdit(draft, newText, 'both') : draft
            ));
            if (dispatch) dispatch({ type: 'UPDATE_SCENE_TEXT', payload: { index, text: newText, mode: 'both' } });
            showNotice('Scene text updated. Regenerate voice to keep narration in sync.', 'info');
        } catch (e) {
            console.error('[App] Rewrite failed:', e);
            handleError(e, "Rewrite");
        }
        if (dispatch) dispatch({ type: 'SET_REWRITING_INDEX', payload: null });
        setEditingCardIndex(null);
    };

    const resolveSceneBrandBinding = (item: SceneDraft) => {
        const preferredAssetId = item.storyboardLinkedAssetId || item.storyboardBaseAssetId || item.brandAssetId;
        const catalogEntry = preferredAssetId
            ? brandAssetCatalog.find((entry) => entry.assetId === preferredAssetId)
            : (typeof item.brandImageIndex === 'number'
                ? brandAssetCatalog.find((entry) => entry.imageIndex === item.brandImageIndex)
                : undefined);
        const imageIndex = item.brandImageIndex ?? catalogEntry?.imageIndex;
        const boundBrandAsset = typeof imageIndex === 'number'
            ? brandKit.productImages?.[imageIndex]
            : undefined;
        return { catalogEntry, imageIndex, boundBrandAsset };
    };

    const buildSceneBrandContext = (
        item: SceneDraft,
        catalogEntry?: BrandAssetCatalogEntry,
    ): string | undefined => {
        const context = [
            catalogEntry?.productIdentity,
            brandKit.visualSignature,
            brandKit.aestheticAnalysis,
            catalogEntry ? `Preserve the real product: ${catalogEntry.productIdentity || catalogEntry.semanticDescription || 'branded item'}. Keep all labels, logos, and packaging exactly as-is.` : undefined,
        ].filter(Boolean).join(' | ');
        return context || undefined;
    };

    const updateSceneDraftsFromBase = (
        baseDrafts: SceneDraft[],
        updater: (drafts: SceneDraft[]) => SceneDraft[],
    ) => {
        const nextDrafts = updater(baseDrafts);
        setSceneDrafts(nextDrafts);
        return nextDrafts;
    };

    const restoreSceneToBoundAsset = (
        baseDrafts: SceneDraft[],
        index: number,
        options?: { label?: string },
    ): boolean => {
        const item = baseDrafts[index];
        if (!item) return false;

        const targetAssetIds = [
            item.storyboardLinkedAssetId,
            item.storyboardBaseAssetId,
            item.brandAssetId,
        ].filter((value): value is string => Boolean(value));
        const matchingVariant = item.imageVariants?.find((variant) => {
            const candidateIds = [
                variant.brandAssetId,
                variant.media.brandAssetId,
                variant.media.storyboardLinkedAssetId,
                variant.media.storyboardBaseAssetId,
            ].filter((value): value is string => Boolean(value));
            return candidateIds.some((candidateId) => targetAssetIds.includes(candidateId));
        });

        if (matchingVariant) {
            updateSceneDraftsFromBase(baseDrafts, (drafts) => drafts.map((draft, draftIndex) => (
                draftIndex === index ? promoteSceneImageVariant(draft, matchingVariant.id) : draft
            )));
            return true;
        }

        const { catalogEntry, imageIndex, boundBrandAsset } = resolveSceneBrandBinding(item);
        if (!boundBrandAsset) {
            return false;
        }

        updateSceneDraftsFromBase(baseDrafts, (drafts) => drafts.map((draft, draftIndex) => {
            if (draftIndex !== index) return draft;
            const resolvedAssetId = draft.storyboardLinkedAssetId || draft.storyboardBaseAssetId || catalogEntry?.assetId || draft.brandAssetId;
            const nextMedia = createExactBrandMedia(
                draft.id,
                draft,
                boundBrandAsset,
                resolvedAssetId,
                catalogEntry,
            );
            return appendSceneImageVariant({
                ...draft,
                imageSource: 'brand_asset',
                brandAssetEditAction: 'use_as_is',
                brandAssetId: resolvedAssetId,
                generationStatus: {
                    ...draft.generationStatus,
                    image: 'clean',
                },
            }, nextMedia, 'brand_asset', {
                brandAssetId: resolvedAssetId,
                label: options?.label || (typeof imageIndex === 'number' ? `Brand ${imageIndex + 1}` : 'Brand'),
                sceneReferenceBindings: draft.sceneReferenceBindings,
                sourceAssetIds: nextMedia.sourceAssetIds,
                provenance: nextMedia.provenance,
            });
        }));
        return true;
    };

    const commitGeneratedSceneImage = (
        baseDrafts: SceneDraft[],
        index: number,
        params: {
            base64: string;
            promptText: string;
            imageSource: SceneDraft['imageSource'];
            assetOrigin: UploadedMedia['assetOrigin'];
            label: string;
            brandAssetId?: string;
            sceneReferenceBindings?: SceneReferenceBinding[];
            sourceAssetIds?: string[];
            provenance?: AssetProvenanceStep[];
            dispatch?: any;
        },
    ) => {
        const sourceAssetIds = params.sourceAssetIds?.length
            ? params.sourceAssetIds
            : params.provenance?.map((step) => step.assetId).filter(Boolean);
        const nextDrafts = updateSceneDraftsFromBase(baseDrafts, (drafts) => drafts.map((draft, draftIndex) => {
            if (draftIndex !== index) return draft;
            const nextDuration = clampSceneDuration(draft.requestedDurationSec || draft.resolvedDurationSec);
            const metadata = extractApprovedStoryboardMetadata(draft);
            const previewUrl = toDataUrl(params.base64);
            const nextMedia: UploadedMedia = {
                ...(draft.media || {
                    file: new File([], `scene_${draft.sceneNumber}.png`),
                    type: 'image' as const,
                    mimeType: 'image/png',
                    previewUrl: '',
                }),
                id: draft.id,
                sceneId: draft.id,
                previewUrl,
                thumbnailUrl: previewUrl,
                base64: params.base64,
                mimeType: 'image/png',
                type: 'image' as const,
                duration: nextDuration,
                extendedDuration: nextDuration,
                imagePrompt: params.promptText,
                description: draft.visualDescription,
                assetOrigin: params.assetOrigin,
                brandAssetId: params.brandAssetId || draft.brandAssetId,
                sceneReferenceBindings: normalizeSceneReferenceBindings(params.sceneReferenceBindings || draft.sceneReferenceBindings, draft),
                sourceAssetIds,
                provenance: params.provenance,
                ...metadata,
            };
            return appendSceneImageVariant({
                ...draft,
                imagePrompt: params.promptText,
                imageSource: params.imageSource,
                brandAssetId: params.brandAssetId || draft.brandAssetId,
                sceneReferenceBindings: normalizeSceneReferenceBindings(params.sceneReferenceBindings || draft.sceneReferenceBindings, draft),
                sourceAssetIds,
                provenance: params.provenance,
                generationStatus: {
                    ...draft.generationStatus,
                    image: 'clean',
                },
            }, nextMedia, params.imageSource, {
                brandAssetId: params.brandAssetId || draft.brandAssetId,
                label: params.label,
                sceneReferenceBindings: params.sceneReferenceBindings || draft.sceneReferenceBindings,
                sourceAssetIds,
                provenance: params.provenance,
            });
        }));
        if (params.dispatch) params.dispatch({ type: 'SET_SCENE_DRAFTS', payload: nextDrafts });
    };

    const executeSceneImageRequest = async (
        baseDrafts: SceneDraft[],
        index: number,
        request: ImageGenerationRequest,
        options: {
            dispatch?: any;
            label: string;
            imageSource: SceneDraft['imageSource'];
            assetOrigin: UploadedMedia['assetOrigin'];
            brandAssetId?: string;
            sceneReferenceBindings?: SceneReferenceBinding[];
            sourceAssetIds?: string[];
            provenance?: AssetProvenanceStep[];
        },
    ) => {
        const promptText = request.imagePrompt.trim();
        if (!promptText) {
            showNotice('Add a visual prompt or scene description first.', 'error');
            return;
        }

        const b64 = await generateImageAsset(request);
        commitGeneratedSceneImage(baseDrafts, index, {
            base64: b64,
            promptText,
            imageSource: options.imageSource,
            assetOrigin: options.assetOrigin,
            label: options.label,
            brandAssetId: options.brandAssetId,
            sceneReferenceBindings: options.sceneReferenceBindings,
            sourceAssetIds: options.sourceAssetIds,
            provenance: options.provenance,
            dispatch: options.dispatch,
        });
    };

    const handleSetSceneRouteOverride = (
        index: number,
        nextRoute?: SceneRoute,
        dispatch?: any,
        draftsOverride?: SceneDraft[],
    ) => {
        const baseDrafts = draftsOverride || sceneDrafts;
        const targetDraft = baseDrafts[index];
        if (!targetDraft) return;

        const normalizedOverride = !nextRoute || nextRoute === targetDraft.storyboardRoute
            ? undefined
            : nextRoute;

        const nextDrafts = baseDrafts.map((draft, draftIndex) => {
            if (draftIndex !== index) return draft;
            return {
                ...draft,
                storyboardRouteOverride: normalizedOverride,
                media: draft.media ? {
                    ...draft.media,
                    storyboardRouteOverride: normalizedOverride,
                } : draft.media,
            };
        });
        setSceneDrafts(nextDrafts);

        if (dispatch) {
            dispatch({
                type: 'UPDATE_SCENE_VISUALS',
                payload: {
                    index,
                    updates: {
                        storyboardRouteOverride: normalizedOverride,
                        media: targetDraft.media ? {
                            ...targetDraft.media,
                            storyboardRouteOverride: normalizedOverride,
                        } : targetDraft.media,
                    },
                },
            });
        }

        if (normalizedOverride) {
            showNotice(`Route override active: ${getScriptStudioRouteLabel(normalizedOverride)}. The approved route is still preserved.`, 'info');
        } else if (targetDraft.storyboardRoute) {
            showNotice(`Returned to the approved route: ${getScriptStudioRouteLabel(targetDraft.storyboardRoute)}.`, 'info');
        }
    };

    const handleExecuteSceneRouteAction = async (
        index: number,
        action: SceneRouteActionId,
        dispatch?: any,
        draftsOverride?: SceneDraft[],
    ) => {
        const baseDrafts = draftsOverride || sceneDrafts;
        const item = baseDrafts[index];
        if (!item) return;
        const mediaPool = draftsOverride ? deriveMediaFromSceneDrafts(baseDrafts) : media;
        const effectiveRoute = getEffectiveStoryboardRoute(item, mediaPool[index]);
        const routeSpec = getRouteActionSpec(item, item.media || mediaPool[index]);
        const { catalogEntry, boundBrandAsset } = resolveSceneBrandBinding(item);
        const resolvedBrandAssetId = item.storyboardLinkedAssetId || item.storyboardBaseAssetId || catalogEntry?.assetId || item.brandAssetId;
        const previousDraft = index > 0 ? baseDrafts[index - 1] : undefined;
        const nextDraft = index < baseDrafts.length - 1 ? baseDrafts[index + 1] : undefined;
        const currentReference = getSceneReferenceInputFromMedia(item.media || mediaPool[index]);
        const previousReference = getSceneReferenceInputFromMedia(previousDraft?.media || mediaPool[index - 1]);
        const nextReference = getSceneReferenceInputFromMedia(nextDraft?.media || mediaPool[index + 1]);
        const hasPreviousSceneReference = Boolean(previousDraft?.media && hasInlineImageReference(previousDraft.media));
        const productAnchor: SceneReferenceBinding | undefined = resolvedBrandAssetId ? {
            assetId: resolvedBrandAssetId,
            source: 'brand_asset',
            role: 'product',
            label: item.storyboardLinkedAssetDescription || item.storyboardBaseAssetDescription || item.productTitle || 'Product anchor',
            description: item.storyboardLinkedAssetDescription || item.storyboardBaseAssetDescription || catalogEntry?.semanticDescription || item.visualDescription,
            previewUrl: boundBrandAsset?.previewUrl || (boundBrandAsset?.base64 ? toDataUrl(boundBrandAsset.base64, boundBrandAsset.mimeType) : undefined),
            mimeType: boundBrandAsset?.mimeType,
            base64: boundBrandAsset?.base64,
        } : undefined;
        const productContext = buildSceneBrandContext(item, catalogEntry);
        const buildAssembly = (route: SceneRoute) => buildRouteReferenceAssembly({
            route,
            scene: item,
            currentReference,
            previousReference,
            nextReference,
            previousSceneText: previousDraft ? (previousDraft.voiceoverText || previousDraft.onScreenText) : undefined,
            nextSceneText: nextDraft ? (nextDraft.voiceoverText || nextDraft.onScreenText) : undefined,
            productAnchor,
            selectedBindings: item.sceneReferenceBindings,
        });

        const startLoading = () => {
            if (dispatch) dispatch({ type: 'SET_REGENERATING_IMAGE_INDEX', payload: index });
        };
        const stopLoading = () => {
            if (dispatch) dispatch({ type: 'SET_REGENERATING_IMAGE_INDEX', payload: null });
        };

        try {
            switch (action) {
                case 'choose_different_asset':
                case 'choose_base_asset':
                    openSceneReferencePicker(index, 'base_asset');
                    return;
                case 'restore_shot':
                case 'reframe_shot': {
                    const restored = restoreSceneToBoundAsset(baseDrafts, index, {
                        label: action === 'reframe_shot' ? 'Reframe' : 'Restore',
                    });
                    if (restored) {
                        showNotice(action === 'reframe_shot'
                            ? 'Restored the approved shot with the bound asset framing.'
                            : 'Restored the approved product shot.', 'info');
                    } else {
                        showNotice(routeSpec.warning || 'No approved asset is currently available for this scene. Choose a base asset or switch routes.', 'info');
                    }
                    return;
                }
                case 'upgrade_shot': {
                    const assembly = buildAssembly('upgrade_existing');
                    const request = assembly.request;
                    if (!request) {
                        showNotice('No upgrade request could be built for this scene. Try choosing a base asset first.', 'info');
                        return;
                    }
                    request.brandContext = productContext;
                    const isFallbackGeneration = !request.primaryReference;
                    if (!request.primaryReference) {
                        console.warn('[App] Upgrade Shot has no primary reference; falling back to a fresh generation.', {
                            index,
                            sceneId: item.id,
                            resolvedBrandAssetId,
                            effectiveRoute,
                        });
                        showNotice('No editable base shot was available, so the app is generating a fresh version from the brief instead.', 'info');
                        request.mode = 'generate';
                    }
                    startLoading();
                    await executeSceneImageRequest(baseDrafts, index, request, {
                        dispatch,
                        label: isFallbackGeneration ? 'Fresh' : 'Upgrade',
                        imageSource: isFallbackGeneration ? 'generated' : 'brand_edit',
                        assetOrigin: isFallbackGeneration ? 'generated' : 'brand_edit',
                        brandAssetId: resolvedBrandAssetId,
                        sceneReferenceBindings: assembly.selectedBindings,
                        sourceAssetIds: assembly.sourceAssetIds,
                        provenance: assembly.provenance,
                    });
                    showNotice(isFallbackGeneration
                        ? 'No editable base shot was available, so a fresh version was generated from the brief.'
                        : 'Shot upgraded from the approved product reference.', 'info');
                    return;
                }
                case 'compose_scene': {
                    startLoading();
                    const assembly = buildAssembly('composite_product');
                    const request = assembly.request;
                    if (!request) return;
                    request.brandContext = productContext;
                    await executeSceneImageRequest(baseDrafts, index, request, {
                        dispatch,
                        label: 'Composite',
                        imageSource: 'generated',
                        assetOrigin: 'generated',
                        brandAssetId: resolvedBrandAssetId,
                        sceneReferenceBindings: assembly.selectedBindings,
                        sourceAssetIds: assembly.sourceAssetIds,
                        provenance: assembly.provenance,
                    });
                    showNotice('Composed a new scene around the approved product.', 'info');
                    return;
                }
                case 'use_previous_shot':
                case 'use_prior_scene_context':
                case 'continue_sequence': {
                    startLoading();
                    const assembly = buildAssembly('continue_sequence');
                    const request = assembly.request;
                    if (!request) return;
                    request.brandContext = productContext;
                    if (!hasPreviousSceneReference) {
                        showNotice('No previous shot reference is available. Generating a fresh scene from the current brief instead.', 'info');
                    }
                    await executeSceneImageRequest(baseDrafts, index, request, {
                        dispatch,
                        label: hasPreviousSceneReference ? 'Continue' : 'Fresh',
                        imageSource: hasPreviousSceneReference ? 'brand_edit' : 'generated',
                        assetOrigin: hasPreviousSceneReference ? 'brand_edit' : 'generated',
                        brandAssetId: resolvedBrandAssetId,
                        sceneReferenceBindings: assembly.selectedBindings,
                        sourceAssetIds: assembly.sourceAssetIds,
                        provenance: assembly.provenance,
                    });
                    showNotice(hasPreviousSceneReference
                        ? 'Continued the sequence using the previous shot as context.'
                        : 'Generated a fresh scene because no previous shot reference was available.', 'info');
                    return;
                }
                case 'generate_new_scene':
                default: {
                    startLoading();
                    const assembly = buildAssembly('generate_fresh');
                    const request = assembly.request;
                    if (!request) return;
                    request.brandContext = productContext;
                    await executeSceneImageRequest(baseDrafts, index, request, {
                        dispatch,
                        label: effectiveRoute === 'generate_fresh' ? 'Fresh' : 'Route',
                        imageSource: 'generated',
                        assetOrigin: 'generated',
                        brandAssetId: resolvedBrandAssetId,
                        sceneReferenceBindings: assembly.selectedBindings,
                        sourceAssetIds: assembly.sourceAssetIds,
                        provenance: assembly.provenance,
                    });
                    showNotice('Generated a new scene from the approved brief.', 'info');
                    return;
                }
            }
        } catch (e) {
            handleError(e, 'Route-Native Image Action');
        } finally {
            stopLoading();
        }
    };

    const handleRegenerateImage = async (index: number, options: { 
        useCurrentAsRef?: boolean, 
        usePrevAsRef?: boolean, 
        useNextAsRef?: boolean 
    } = {}, overridePrompt?: string, dispatch?: any) => {
        const item = sceneDrafts[index];
        if (!item) return;
        if (dispatch) dispatch({ type: 'SET_REGENERATING_IMAGE_INDEX', payload: index });
        try {
            const promptText = (overridePrompt || getSceneVisualPrompt(item, media[index])).trim();
            if (!promptText) {
                showNotice('Add a visual prompt or scene description first.', 'error');
                if (dispatch) dispatch({ type: 'SET_REGENERATING_IMAGE_INDEX', payload: null });
                return;
            }
            const catalogEntry = item.brandAssetId
                ? brandAssetCatalog.find((entry) => entry.assetId === item.brandAssetId)
                : (typeof item.brandImageIndex === 'number'
                    ? brandAssetCatalog.find((entry) => entry.imageIndex === item.brandImageIndex)
                    : undefined);
            const imageIndex = item.brandImageIndex ?? catalogEntry?.imageIndex;
            const boundBrandAsset = typeof imageIndex === 'number'
                ? brandKit.productImages?.[imageIndex]
                : undefined;
            const shouldUseExactBrandAsset = boundBrandAsset && shouldPreferExactBrandAssetScene({
                visualDescription: item.visualDescription,
                imagePrompt: item.imagePrompt,
                scriptGuidance: item.voiceoverText || item.onScreenText,
                brandAssetEditAction: item.brandAssetEditAction,
            }, catalogEntry);

            if (shouldUseExactBrandAsset) {
                const nextDuration = clampSceneDuration(item.requestedDurationSec || item.resolvedDurationSec);
                const previewUrl = boundBrandAsset.previewUrl || toDataUrl(boundBrandAsset.base64, boundBrandAsset.mimeType);
                setSceneDrafts(prev => prev.map((draft, draftIndex) => {
                    if (draftIndex !== index) return draft;
                    const nextMedia = {
                        ...(draft.media || {
                            file: boundBrandAsset.file || new File([], `brand_asset_${imageIndex}.jpg`),
                            type: 'image' as const,
                            mimeType: boundBrandAsset.mimeType,
                            previewUrl,
                        }),
                        id: draft.id,
                        sceneId: draft.id,
                        file: boundBrandAsset.file || new File([], `brand_asset_${imageIndex}.jpg`),
                        previewUrl,
                        thumbnailUrl: previewUrl,
                        base64: boundBrandAsset.base64,
                        mimeType: boundBrandAsset.mimeType,
                        type: 'image' as const,
                        duration: nextDuration,
                        extendedDuration: nextDuration,
                        assetOrigin: 'brand_asset' as const,
                        brandAssetId: catalogEntry?.assetId,
                        description: draft.visualDescription,
                        imagePrompt: draft.imagePrompt,
                        aiFramingMode: catalogEntry?.framingMode,
                        aiFramingFocusY: catalogEntry?.framingFocusY,
                        aiPresentationReason: catalogEntry?.presentationReason,
                    };
                    return appendSceneImageVariant({
                        ...draft,
                        imageSource: 'brand_asset',
                        brandAssetEditAction: 'use_as_is',
                        generationStatus: {
                            ...draft.generationStatus,
                            image: 'clean',
                        },
                    }, nextMedia, 'brand_asset', {
                        brandAssetId: catalogEntry?.assetId,
                        label: 'Brand',
                    });
                }));
                if (dispatch) dispatch({ type: 'SET_REGENERATING_IMAGE_INDEX', payload: null });
                return;
            }

            const mode = (hasInlineImageReference(item.media) && (options.useCurrentAsRef || options.usePrevAsRef || options.useNextAsRef)) ? 'edit' : 'generate';
            const request = buildSceneImageGenerationRequest(sceneDrafts, index, mode);
            if (!request) return;
            request.imagePrompt = promptText;
            if (!request.primaryReference && item.referenceImageBase64) {
                request.primaryReference = {
                    data: item.referenceImageBase64,
                    mimeType: item.referenceImageMimeType || 'image/png',
                };
            }
            request.brandContext = [
                item.brandAssetId ? brandAssetCatalog.find((entry) => entry.assetId === item.brandAssetId)?.productIdentity : undefined,
                brandKit.visualSignature,
                brandKit.aestheticAnalysis,
                item.brandAssetId && catalogEntry ? `Preserve the real product: ${catalogEntry.productIdentity || catalogEntry.semanticDescription || 'branded item'}. Keep all labels, logos, and packaging exactly as-is.` : undefined,
            ].filter(Boolean).join(' | ');
            if (!options.usePrevAsRef) {
                request.prevSceneReference = undefined;
                request.prevSceneText = undefined;
            }
            if (!options.useNextAsRef) {
                request.nextSceneReference = undefined;
                request.nextSceneText = undefined;
            }
            const b64 = await generateImageAsset(request);
            setSceneDrafts(prev => prev.map((draft, draftIndex) => {
                    if (draftIndex !== index) return draft;
                    const nextDuration = clampSceneDuration(draft.requestedDurationSec || draft.resolvedDurationSec);
                    const nextMedia = {
                        ...(draft.media || {
                            file: new File([], `scene_${draft.sceneNumber}.png`),
                            type: 'image' as const,
                            mimeType: 'image/png',
                            previewUrl: '',
                        }),
                        sceneId: draft.id,
                        previewUrl: `data:image/png;base64,${b64}`,
                        thumbnailUrl: `data:image/png;base64,${b64}`,
                        base64: b64,
                        mimeType: 'image/png',
                        type: 'image' as const,
                        duration: nextDuration,
                        extendedDuration: nextDuration,
                        imagePrompt: promptText,
                        description: draft.visualDescription,
                        assetOrigin: mode === 'edit' ? 'brand_edit' as const : 'generated' as const,
                        brandAssetId: draft.brandAssetId,
                    };
                    return appendSceneImageVariant({
                        ...draft,
                        imagePrompt: promptText,
                        imageSource: mode === 'edit' ? 'brand_edit' : 'generated',
                        generationStatus: {
                            ...draft.generationStatus,
                            image: 'clean',
                        },
                    }, nextMedia, mode === 'edit' ? 'brand_edit' : 'generated', {
                        brandAssetId: draft.brandAssetId,
                        label: mode === 'edit' ? 'AI Edit' : 'AI',
                    });
            }));
        } catch (e) { handleError(e, "Image Regeneration"); }
        if (dispatch) dispatch({ type: 'SET_REGENERATING_IMAGE_INDEX', payload: null });
    };

    const handleSceneImageUpload = async (index: number, file: File) => {
        if (!sceneDrafts[index]) return;
        try {
            if (!file.type.startsWith('image/')) {
                showNotice('Please upload an image file (JPG, PNG, WEBP).', 'error');
                return;
            }
            const base64 = await fileToBase64(file);
            const previewUrl = URL.createObjectURL(file);
            const presentation = await analyzeImagePresentation({
                base64,
                mimeType: file.type,
                description: sceneDrafts[index]?.visualDescription,
                imagePrompt: sceneDrafts[index]?.imagePrompt
            }, {
                sceneText: sceneDrafts[index]?.voiceoverText || sceneDrafts[index]?.onScreenText,
                sourceHint: 'scene_image_upload'
            });
            setSceneDrafts(prev => prev.map((draft, draftIndex) => {
                if (draftIndex !== index) return draft;
                const nextDuration = clampSceneDuration(draft.requestedDurationSec || draft.resolvedDurationSec);
                const nextMedia = {
                    ...(draft.media || {
                        file,
                        type: 'image' as const,
                        mimeType: file.type,
                        previewUrl,
                    }),
                    id: draft.id,
                    sceneId: draft.id,
                    file,
                    previewUrl,
                    thumbnailUrl: previewUrl,
                    base64,
                    mimeType: file.type,
                    type: 'image' as const,
                    duration: nextDuration,
                    extendedDuration: nextDuration,
                    assetOrigin: 'user_upload' as const,
                    description: draft.visualDescription,
                    imagePrompt: draft.imagePrompt,
                    aiFramingMode: presentation.aiFramingMode,
                    aiFramingFocusY: presentation.aiFramingFocusY,
                    aiPresentationReason: presentation.aiPresentationReason,
                };
                return appendSceneImageVariant({
                    ...draft,
                    imageSource: 'uploaded',
                    brandAssetId: undefined,
                    generationStatus: {
                        ...draft.generationStatus,
                        image: 'clean',
                    },
                }, nextMedia, 'uploaded', {
                    label: 'Upload',
                });
            }));
        } catch (error) {
            console.error('Scene image upload failed', error);
            showNotice('Unable to process that image. Please try again.', 'error');
        }
    };

    const handleSceneImageInput = async (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await handleSceneImageUpload(index, file);
    };

    const openSceneImagePicker = useCallback((sceneId: string) => {
        sceneImageInputRefs.current[sceneId]?.click();
    }, []);

    const openSceneReferencePicker = useCallback((sceneIndex: number, mode: SceneReferencePickerState['mode']) => {
        setSceneReferencePickerState({ sceneIndex, mode });
    }, []);

    const closeSceneReferencePicker = useCallback(() => {
        setSceneReferencePickerState(null);
    }, []);

    const buildBrandAssetReferenceOption = useCallback((
        assetId: string,
        asset: VisualAsset,
        catalogEntry?: BrandAssetCatalogEntry,
        section = 'Product Assets',
        current = false,
    ): SceneReferencePickerOption => ({
        key: getSceneReferenceKey({ source: 'brand_asset', assetId }),
        assetId,
        source: 'brand_asset',
        role: 'product',
        label: catalogEntry?.productIdentity || asset.description || 'Brand asset',
        description: catalogEntry?.semanticDescription || asset.description,
        previewUrl: asset.previewUrl || toDataUrl(asset.base64, asset.mimeType),
        mimeType: asset.mimeType,
        base64: asset.base64,
        section,
        note: catalogEntry?.presentationReason,
        current,
    }), []);

    const buildSceneVariantReferenceOption = useCallback((
        draft: SceneDraft,
        variant: SceneDraft['imageVariants'][number],
        section: string,
        current = false,
    ): SceneReferencePickerOption => {
        const assetId = variant.brandAssetId || variant.media.brandAssetId || variant.media.id || variant.id;
        return {
            key: getSceneReferenceKey({
                source: 'scene_variant',
                assetId,
                variantId: variant.id,
                sourceSceneId: draft.id,
            }),
            assetId,
            source: 'scene_variant',
            role: 'reference',
            label: variant.label,
            description: variant.media.description || draft.visualDescription,
            previewUrl: getMediaDisplayUrl(variant.media),
            mimeType: variant.media.mimeType,
            base64: variant.media.base64,
            sourceSceneId: draft.id,
            variantId: variant.id,
            section,
            note: draft.productTitle ? `${draft.productTitle} • Scene ${draft.sceneNumber}` : `Scene ${draft.sceneNumber}`,
            current,
        };
    }, []);

    const sceneReferencePickerContext = useMemo(() => {
        if (!sceneReferencePickerState) {
            return {
                scene: undefined as SceneDraft | undefined,
                candidates: [] as SceneReferencePickerOption[],
                currentBindings: [] as SceneReferenceBinding[],
                currentBaseSelectionKey: undefined as string | undefined,
            };
        }

        const scene = sceneDrafts[sceneReferencePickerState.sceneIndex];
        if (!scene) {
            return {
                scene: undefined as SceneDraft | undefined,
                candidates: [] as SceneReferencePickerOption[],
                currentBindings: [] as SceneReferenceBinding[],
                currentBaseSelectionKey: undefined as string | undefined,
            };
        }

        const candidates: SceneReferencePickerOption[] = [];
        const seenKeys = new Set<string>();
        const pushCandidate = (candidate: SceneReferencePickerOption | undefined) => {
            if (!candidate || seenKeys.has(candidate.key)) return;
            seenKeys.add(candidate.key);
            candidates.push(candidate);
        };

        brandAssetCatalog.forEach((entry) => {
            const visualAsset = typeof entry.imageIndex === 'number' ? brandKit.productImages?.[entry.imageIndex] : undefined;
            if (!visualAsset || !entry.assetId) return;
            pushCandidate(buildBrandAssetReferenceOption(
                entry.assetId,
                visualAsset,
                entry,
                'Product Assets',
                scene.brandAssetId === entry.assetId,
            ));
        });

        scene.imageVariants?.forEach((variant) => {
            pushCandidate(buildSceneVariantReferenceOption(
                scene,
                variant,
                'Current Scene Variants',
                scene.activeVariantId === variant.id,
            ));
        });

        const previousDraft = sceneReferencePickerState.sceneIndex > 0 ? sceneDrafts[sceneReferencePickerState.sceneIndex - 1] : undefined;
        previousDraft?.imageVariants?.forEach((variant) => {
            pushCandidate(buildSceneVariantReferenceOption(previousDraft, variant, 'Previous Scene Variants'));
        });

        if (sceneReferencePickerState.mode === 'reference_assets') {
            const nextDraft = sceneReferencePickerState.sceneIndex < sceneDrafts.length - 1
                ? sceneDrafts[sceneReferencePickerState.sceneIndex + 1]
                : undefined;
            nextDraft?.imageVariants?.forEach((variant) => {
                pushCandidate(buildSceneVariantReferenceOption(nextDraft, variant, 'Next Scene Variants'));
            });
            normalizeSceneReferenceBindings(scene.sceneReferenceBindings, scene)
                .filter((binding) => binding.source === 'external_image')
                .forEach((binding) => {
                    pushCandidate({
                        ...binding,
                        key: getSceneReferenceKey(binding),
                        section: 'Existing External References',
                        current: true,
                    });
                });
        }

        const currentBindings = normalizeSceneReferenceBindings(scene.sceneReferenceBindings, scene);
        const currentBaseSelectionKey = scene.activeVariantId
            ? candidates.find((candidate) => candidate.source === 'scene_variant' && candidate.sourceSceneId === scene.id && candidate.variantId === scene.activeVariantId)?.key
            : undefined;

        return {
            scene,
            candidates: sceneReferencePickerState.mode === 'base_asset'
                ? candidates.filter((candidate) => candidate.source !== 'external_image')
                : candidates,
            currentBindings,
            currentBaseSelectionKey: currentBaseSelectionKey || (
                scene.brandAssetId
                    ? candidates.find((candidate) => candidate.source === 'brand_asset' && candidate.assetId === scene.brandAssetId)?.key
                    : undefined
            ),
        };
    }, [
        brandAssetCatalog,
        brandKit.productImages,
        buildBrandAssetReferenceOption,
        buildSceneVariantReferenceOption,
        sceneDrafts,
        sceneReferencePickerState,
    ]);

    const handleApplyBaseAssetSelection = useCallback((binding: SceneReferencePickerOption) => {
        if (!sceneReferencePickerState) return;
        const index = sceneReferencePickerState.sceneIndex;
        const targetDraft = sceneDrafts[index];
        if (!targetDraft) return;

        if (binding.source === 'brand_asset') {
            const catalogEntry = brandAssetCatalog.find((entry) => entry.assetId === binding.assetId);
            const visualAsset = typeof catalogEntry?.imageIndex === 'number'
                ? brandKit.productImages?.[catalogEntry.imageIndex]
                : undefined;
            if (!visualAsset) {
                showNotice('That brand asset is no longer available in the current brand kit.', 'error');
                return;
            }
            setSceneDrafts((prev) => prev.map((draft, draftIndex) => {
                if (draftIndex !== index) return draft;
                const nextMedia = createExactBrandMedia(draft.id, draft, visualAsset, binding.assetId, catalogEntry);
                return appendSceneImageVariant({
                    ...draft,
                    imageSource: 'brand_asset',
                    brandAssetId: binding.assetId,
                    brandImageIndex: catalogEntry?.imageIndex,
                    generationStatus: {
                        ...draft.generationStatus,
                        image: 'clean',
                    },
                }, nextMedia, 'brand_asset', {
                    brandAssetId: binding.assetId,
                    label: binding.label,
                    sceneReferenceBindings: draft.sceneReferenceBindings,
                    sourceAssetIds: nextMedia.sourceAssetIds,
                    provenance: nextMedia.provenance,
                });
            }));
            showNotice('Base product asset updated for this scene.', 'info');
            closeSceneReferencePicker();
            return;
        }

        if (binding.source === 'scene_variant') {
            const sourceDraft = sceneDrafts.find((draft) => draft.id === binding.sourceSceneId);
            const sourceVariant = sourceDraft?.imageVariants?.find((variant) => variant.id === binding.variantId);
            if (!sourceDraft || !sourceVariant) {
                showNotice('That scene variant is no longer available.', 'error');
                return;
            }

            setSceneDrafts((prev) => prev.map((draft, draftIndex) => {
                if (draftIndex !== index) return draft;
                if (draft.id === sourceDraft.id && binding.variantId) {
                    const promoted = promoteSceneImageVariant(draft, binding.variantId);
                    return {
                        ...promoted,
                        brandAssetId: sourceVariant.brandAssetId || sourceVariant.media.brandAssetId || promoted.brandAssetId,
                    };
                }

                return appendSceneImageVariant({
                    ...draft,
                    imageSource: sourceVariant.imageSource,
                    brandAssetId: sourceVariant.brandAssetId || sourceVariant.media.brandAssetId || draft.brandAssetId,
                    generationStatus: {
                        ...draft.generationStatus,
                        image: 'clean',
                    },
                }, {
                    ...sourceVariant.media,
                    sceneId: draft.id,
                    sceneReferenceBindings: draft.sceneReferenceBindings,
                }, sourceVariant.imageSource, {
                    brandAssetId: sourceVariant.brandAssetId || sourceVariant.media.brandAssetId || draft.brandAssetId,
                    label: binding.label,
                    sceneReferenceBindings: draft.sceneReferenceBindings,
                    sourceAssetIds: sourceVariant.media.sourceAssetIds || sourceVariant.sourceAssetIds,
                    provenance: sourceVariant.media.provenance || sourceVariant.provenance,
                });
            }));
            showNotice('Base scene variant applied.', 'info');
            closeSceneReferencePicker();
        }
    }, [
        brandAssetCatalog,
        brandKit.productImages,
        closeSceneReferencePicker,
        sceneDrafts,
        sceneReferencePickerState,
    ]);

    const handleSaveSceneReferenceBindings = useCallback((bindings: SceneReferenceBinding[]) => {
        if (!sceneReferencePickerState) return;
        const index = sceneReferencePickerState.sceneIndex;
        const normalizedBindings = normalizeSceneReferenceBindings(bindings);
        setSceneDrafts((prev) => prev.map((draft, draftIndex) => {
            if (draftIndex !== index) return draft;
            return {
                ...draft,
                sceneReferenceBindings: normalizedBindings,
                referenceImageBase64: undefined,
                referenceImageMimeType: undefined,
                media: draft.media ? {
                    ...draft.media,
                    sceneReferenceBindings: normalizedBindings,
                } : draft.media,
            };
        }));
        showNotice(
            normalizedBindings.length
                ? `Saved ${normalizedBindings.length} scene reference${normalizedBindings.length === 1 ? '' : 's'}.`
                : 'Cleared extra scene references.',
            'info',
        );
        closeSceneReferencePicker();
    }, [closeSceneReferencePicker, sceneReferencePickerState]);

    const insertGeneratedScene = async (payload: {
        segmentText: string;
        visualDescription: string;
        imagePrompt: string;
    }, insertAtIndex?: number, dispatch?: any, contextDrafts?: SceneDraft[]) => {
        if (!script) return;
        const baseDrafts = contextDrafts || sceneDrafts;
        const sceneId = getSceneDraftId();
        const idx = insertAtIndex ?? baseDrafts.length;
        const previousDraft = idx > 0 ? baseDrafts[idx - 1] : undefined;
        const nextDraft = idx < baseDrafts.length ? baseDrafts[idx] : undefined;
        const requestedDurationSec = 3;
        const placeholderMedia: UploadedMedia = {
            id: sceneId,
            sceneId,
            file: new File([], `${sceneId}.png`),
            previewUrl: '',
            thumbnailUrl: '',
            mimeType: 'image/png',
            type: 'image',
            duration: requestedDurationSec,
            extendedDuration: requestedDurationSec,
            description: payload.visualDescription,
            imagePrompt: payload.imagePrompt,
            transitionEffect: 'fade',
            assetOrigin: 'generated',
        };

        const newDraft: SceneDraft = {
            id: sceneId,
            sceneNumber: idx + 1,
            visualDescription: payload.visualDescription,
            imagePrompt: payload.imagePrompt,
            voiceoverText: payload.segmentText,
            onScreenText: payload.segmentText,
            requestedDurationSec,
            resolvedDurationSec: requestedDurationSec,
            imageSource: 'generated',
            captionMode: 'derived',
            generationStatus: {
                script: 'clean',
                image: 'generating',
                voice: 'stale',
            },
            media: placeholderMedia,
        };

        const updatedDrafts = [...baseDrafts];
        updatedDrafts.splice(idx, 0, newDraft);
        const renumberedDrafts = updatedDrafts.map((d, i) => ({ ...d, sceneNumber: i + 1 }));

        setSceneDrafts(renumberedDrafts);
        if (dispatch) dispatch({ type: 'SET_SCENE_DRAFTS', payload: renumberedDrafts });

        const prevRef = previousDraft?.media?.base64 ? {
            data: previousDraft.media.base64,
            mimeType: previousDraft.media.mimeType,
            assetId: previousDraft.brandAssetId,
        } : undefined;
        const nextRef = nextDraft?.media?.base64 ? {
            data: nextDraft.media.base64,
            mimeType: nextDraft.media.mimeType,
            assetId: nextDraft.brandAssetId,
        } : undefined;

        // Fire image generation in the background — don't block the caller.
        // This ensures isAddingScene resets quickly and the scene appears immediately.
        generateImageAsset({
            mode: 'generate',
            imagePrompt: payload.imagePrompt,
            visualDescription: payload.visualDescription,
            currentSceneText: payload.segmentText,
            brandContext: [brandKit.visualSignature, brandKit.aestheticAnalysis]
                .filter(Boolean).join(' | ') || undefined,
            prevSceneReference: prevRef,
            prevSceneText: previousDraft?.voiceoverText || previousDraft?.onScreenText,
            nextSceneReference: nextRef,
            nextSceneText: nextDraft?.voiceoverText || nextDraft?.onScreenText,
        }).then((b64) => {
            const dataUrl = toDataUrl(b64);
            setSceneDrafts(prev => prev.map((draft) => {
                if (draft.id !== sceneId) return draft;
                const updatedMedia: UploadedMedia = {
                    ...(draft.media || placeholderMedia),
                    id: sceneId,
                    sceneId,
                    base64: b64,
                    previewUrl: dataUrl,
                    thumbnailUrl: dataUrl,
                    mimeType: 'image/png',
                    type: 'image',
                    duration: requestedDurationSec,
                    extendedDuration: requestedDurationSec,
                    description: payload.visualDescription,
                    imagePrompt: payload.imagePrompt,
                };
                return appendSceneImageVariant({
                    ...draft,
                    generationStatus: {
                        ...draft.generationStatus,
                        image: 'clean',
                    },
                    media: updatedMedia,
                }, updatedMedia, 'generated');
            }));
        }).catch((imgErr) => {
            console.warn('Failed to generate image for new scene', imgErr);
            setSceneDrafts(prev => prev.map(draft =>
                draft.id === sceneId
                    ? { ...draft, generationStatus: { ...draft.generationStatus, image: 'stale' } }
                    : draft
            ));
        });
    };

    const handleAddSceneToPlan = async () => {
        if (!reelPlan || !addScenePrompt.trim()) return;
        setIsAddingScene(true);
        try {
            const newScene = await generateSingleScenePlan(reelPlan.topic, reelPlan.scenes, addScenePrompt);
            setReelPlan({ ...reelPlan, scenes: [...reelPlan.scenes, newScene] });
            setAddScenePrompt('');
        } catch (e) {
            handleError(e, 'Add Scene');
        }
        setIsAddingScene(false);
    };

    const handleSmartAddPlanScene = async () => {
        if (!reelPlan) return;
        setIsAiAddingPlanScene(true);
        try {
            const smartInstruction = reelPlan.scenes.length > 0
                ? 'Add one strong new scene that improves pacing, keeps the same locked product identity, and adds a visually distinct beat.'
                : 'Create a sharp opening scene for the locked product with a stronger hook and clear product presence.';
            const newScene = await generateSingleScenePlan(reelPlan.topic, reelPlan.scenes, smartInstruction);
            setReelPlan({ ...reelPlan, scenes: [...reelPlan.scenes, newScene] });
        } catch (e) {
            handleError(e, 'AI Add Scene');
        }
        setIsAiAddingPlanScene(false);
    };

    const resolvePlanSceneBrandReference = (scene: ScenePlan) => {
        if (typeof scene.brandImageIndex === 'number' && brandKit.productImages?.[scene.brandImageIndex]) {
            return brandKit.productImages[scene.brandImageIndex];
        }
        return undefined;
    };

    const handleGeneratePlanSceneImage = async (
        index: number,
        options: { useCurrentAsRef?: boolean; usePrevAsRef?: boolean; useNextAsRef?: boolean } = {},
        overridePrompt?: string,
    ) => {
        if (!reelPlan?.scenes[index]) return;
        const scene = reelPlan.scenes[index];
        const promptText = (overridePrompt || scene.imagePrompt || scene.visualDescription).trim();
        if (!promptText) {
            showNotice('Add a visual prompt or scene description first.', 'error');
            return;
        }

        setPlanImageActionIndex(index);
        try {
            const currentBrandRef = resolvePlanSceneBrandReference(scene);
            const currentReference = scene.userProvidedImage?.base64
                ? {
                    data: scene.userProvidedImage.base64,
                    mimeType: scene.userProvidedImage.mimeType,
                    assetId: scene.userProvidedImage.brandAssetId,
                }
                : currentBrandRef?.base64
                    ? {
                        data: currentBrandRef.base64,
                        mimeType: currentBrandRef.mimeType,
                        assetId: currentBrandRef.assetId,
                    }
                    : undefined;
            const prevScene = index > 0 ? reelPlan.scenes[index - 1] : undefined;
            const nextScene = index < reelPlan.scenes.length - 1 ? reelPlan.scenes[index + 1] : undefined;
            const prevBrandRef = prevScene ? resolvePlanSceneBrandReference(prevScene) : undefined;
            const nextBrandRef = nextScene ? resolvePlanSceneBrandReference(nextScene) : undefined;
            const request = {
                mode: currentReference && (options.useCurrentAsRef || options.usePrevAsRef || options.useNextAsRef) ? 'edit' as const : 'generate' as const,
                imagePrompt: promptText,
                visualDescription: scene.visualDescription,
                currentSceneText: scene.scriptGuidance,
                brandContext: [
                    brandKit.visualSignature,
                    brandKit.aestheticAnalysis,
                    currentReference ? 'Preserve the same locked product identity, label, packaging text, cap, bottle shape, and proportions.' : undefined,
                ].filter(Boolean).join(' | '),
                primaryReference: options.useCurrentAsRef !== false ? currentReference : undefined,
                prevSceneReference: options.usePrevAsRef && prevScene?.userProvidedImage?.base64
                    ? {
                        data: prevScene.userProvidedImage.base64,
                        mimeType: prevScene.userProvidedImage.mimeType,
                        assetId: prevScene.userProvidedImage.brandAssetId,
                    }
                    : options.usePrevAsRef && prevBrandRef?.base64
                        ? {
                            data: prevBrandRef.base64,
                            mimeType: prevBrandRef.mimeType,
                            assetId: prevBrandRef.assetId,
                        }
                        : undefined,
                nextSceneReference: options.useNextAsRef && nextScene?.userProvidedImage?.base64
                    ? {
                        data: nextScene.userProvidedImage.base64,
                        mimeType: nextScene.userProvidedImage.mimeType,
                        assetId: nextScene.userProvidedImage.brandAssetId,
                    }
                    : options.useNextAsRef && nextBrandRef?.base64
                        ? {
                            data: nextBrandRef.base64,
                            mimeType: nextBrandRef.mimeType,
                            assetId: nextBrandRef.assetId,
                        }
                        : undefined,
                prevSceneText: options.usePrevAsRef ? prevScene?.scriptGuidance : undefined,
                nextSceneText: options.useNextAsRef ? nextScene?.scriptGuidance : undefined,
            };
            const b64 = await generateImageAsset(request);
            const presentation = await analyzeImagePresentation({
                base64: b64,
                mimeType: 'image/png',
                description: scene.visualDescription,
                imagePrompt: promptText,
            }, {
                sceneText: scene.scriptGuidance,
                sourceHint: request.mode === 'edit' ? 'plan_scene_ai_edit' : 'plan_scene_ai_generate',
            });
            const planSceneMediaId = getSceneDraftId();
            const nextMedia: UploadedMedia = {
                id: planSceneMediaId,
                sceneId: planSceneMediaId,
                file: new File([], `plan_scene_${index + 1}.png`),
                previewUrl: toDataUrl(b64),
                thumbnailUrl: toDataUrl(b64),
                base64: b64,
                mimeType: 'image/png',
                type: 'image',
                duration: scene.estimatedDuration || 3,
                extendedDuration: scene.estimatedDuration || 3,
                description: scene.visualDescription,
                imagePrompt: promptText,
                assetOrigin: request.mode === 'edit' ? 'brand_edit' : 'generated',
                brandAssetId: currentReference?.assetId,
                aiFramingMode: presentation.aiFramingMode,
                aiFramingFocusY: presentation.aiFramingFocusY,
                aiPresentationReason: presentation.aiPresentationReason,
            };
            setReelPlan(prev => {
                if (!prev || !prev.scenes[index]) return prev;
                const scenes = [...prev.scenes];
                scenes[index] = {
                    ...scenes[index],
                    imagePrompt: promptText,
                    userProvidedImage: nextMedia,
                };
                return { ...prev, scenes };
            });
            showNotice(request.mode === 'edit' ? 'AI image edit applied to this scene.' : 'AI image generated for this scene.', 'info');
        } catch (e) {
            handleError(e, 'Plan Image Generation');
        }
        setPlanImageActionIndex(null);
    };

    const handleSmartPlanImageEdit = async (index: number) => {
        if (!reelPlan?.scenes[index]) return;
        const scene = reelPlan.scenes[index];
        const currentBrandRef = resolvePlanSceneBrandReference(scene);
        const currentMedia = scene.userProvidedImage || (currentBrandRef ? {
            file: currentBrandRef.file || new File([], `brand_asset_${index + 1}.jpg`),
            previewUrl: currentBrandRef.previewUrl,
            thumbnailUrl: currentBrandRef.previewUrl,
            base64: currentBrandRef.base64,
            mimeType: currentBrandRef.mimeType,
            type: 'image' as const,
            duration: scene.estimatedDuration || 3,
            description: scene.visualDescription,
            imagePrompt: scene.imagePrompt,
            assetOrigin: 'brand_asset' as const,
            brandAssetId: currentBrandRef.assetId,
        } : undefined);

        if (!currentMedia?.base64) {
            showNotice('Upload or bind an image first so AI can edit it intelligently.', 'info');
            return;
        }

        setPlanImageActionIndex(index);
        try {
            const suggestion = await suggestSceneImageEdit({
                base64: currentMedia.base64,
                mimeType: currentMedia.mimeType || 'image/png',
                description: scene.visualDescription,
                imagePrompt: scene.imagePrompt,
            }, {
                sceneText: scene.scriptGuidance,
                previousSceneText: index > 0 ? reelPlan.scenes[index - 1]?.scriptGuidance : undefined,
                nextSceneText: index < reelPlan.scenes.length - 1 ? reelPlan.scenes[index + 1]?.scriptGuidance : undefined,
                brandContext: [brandKit.visualSignature, brandKit.aestheticAnalysis].filter(Boolean).join(' | ') || undefined,
                sourceHint: 'review_plan_image_edit',
            });
            setReelPlan(prev => {
                if (!prev || !prev.scenes[index]) return prev;
                const scenes = [...prev.scenes];
                scenes[index] = {
                    ...scenes[index],
                    imagePrompt: suggestion.imagePrompt,
                    userProvidedImage: scenes[index].userProvidedImage ? {
                        ...scenes[index].userProvidedImage!,
                        imagePrompt: suggestion.imagePrompt,
                        aiFramingMode: suggestion.framingMode,
                        aiFramingFocusY: suggestion.framingFocusY,
                        aiPresentationReason: suggestion.reasoning,
                    } : scenes[index].userProvidedImage,
                };
                return { ...prev, scenes };
            });
            await handleGeneratePlanSceneImage(index, { useCurrentAsRef: true, usePrevAsRef: true, useNextAsRef: true }, suggestion.imagePrompt);
            showNotice(`AI image edit: ${suggestion.reasoning}`, 'info');
        } catch (e) {
            handleError(e, 'AI Plan Image Edit');
        }
        setPlanImageActionIndex(null);
    };

    const handleAddSceneToScript = async (promptOverride?: string, dispatch?: any, insertAtIndex?: number, contextDrafts?: SceneDraft[]) => {
        const promptToUse = promptOverride || addScenePrompt;
        if (!script || !promptToUse.trim()) return;
        
        setIsAddingScene(true);
        if (dispatch) dispatch({ type: 'SET_IS_ADDING_SCENE', payload: true });
        
        try {
            const drafts = contextDrafts || sceneDrafts;
            const idx = insertAtIndex ?? drafts.length;
            const prevDraft = idx > 0 ? drafts[idx - 1] : undefined;
            const nextDraft = idx < drafts.length ? drafts[idx] : undefined;

            const { segmentText, visualDescription, imagePrompt } = await generateSingleScriptSegment(
                script.fullText,
                promptToUse,
                {
                    prevSceneText: prevDraft?.voiceoverText || prevDraft?.onScreenText,
                    prevVisualDescription: prevDraft?.visualDescription,
                    nextSceneText: nextDraft?.voiceoverText || nextDraft?.onScreenText,
                    nextVisualDescription: nextDraft?.visualDescription,
                    insertPosition: idx,
                    totalScenes: drafts.length,
                    brandContext: [brandKit.visualSignature, brandKit.aestheticAnalysis].filter(Boolean).join(' | ') || undefined,
                    allSegments: script.segments,
                }
            );
            await insertGeneratedScene({ segmentText, visualDescription, imagePrompt }, insertAtIndex, dispatch, drafts);
            setAddScenePrompt('');
            if (dispatch) dispatch({ type: 'SET_ADD_SCENE_PROMPT', payload: '' });
        } catch (e) {
            handleError(e, 'Add Scene to Script');
        }
        setIsAddingScene(false);
        if (dispatch) dispatch({ type: 'SET_IS_ADDING_SCENE', payload: false });
    };

    const handleSmartAddScene = async (dispatch?: any, contextDrafts?: SceneDraft[]) => {
        if (!script) return;
        const drafts = contextDrafts || sceneDrafts;
        
        setIsAddingScene(true);
        if (dispatch) dispatch({ type: 'SET_IS_ADDING_SCENE', payload: true });
        
        try {
            const prevDraft = drafts[drafts.length - 1];
            const smartInstruction = drafts.length > 0
                ? 'Add a new scene that continues the current script, introduces a fresh visual beat, and improves pacing.'
                : 'Create a strong opening scene that sharpens the hook and makes the reel feel more direct and engaging.';
            const { segmentText, visualDescription, imagePrompt } = await generateSingleScriptSegment(
                script.fullText,
                smartInstruction,
                {
                    prevSceneText: prevDraft?.voiceoverText || prevDraft?.onScreenText,
                    prevVisualDescription: prevDraft?.visualDescription,
                    insertPosition: drafts.length,
                    totalScenes: drafts.length,
                    brandContext: [brandKit.visualSignature, brandKit.aestheticAnalysis].filter(Boolean).join(' | ') || undefined,
                    allSegments: script.segments,
                }
            );
            await insertGeneratedScene({ segmentText, visualDescription, imagePrompt }, undefined, dispatch, drafts);
        } catch (e) {
            handleError(e, 'AI Add Scene');
        }
        setIsAddingScene(false);
        if (dispatch) dispatch({ type: 'SET_IS_ADDING_SCENE', payload: false });
    };

    const handlePlanSceneImageUpload = async (index: number, file: File) => {
        if (!file.type.startsWith('image/')) {
            showNotice('Please upload an image file (JPG, PNG, WEBP).', 'error');
            return;
        }
        try {
            const base64 = await fileToBase64(file);
            const previewUrl = URL.createObjectURL(file);
            const currentScene = reelPlan?.scenes[index];
            const presentation = await analyzeImagePresentation({
                base64,
                mimeType: file.type,
                description: currentScene?.visualDescription,
                imagePrompt: currentScene?.imagePrompt
            }, {
                sceneText: currentScene?.scriptGuidance,
                sourceHint: 'plan_scene_upload'
            });
            setReelPlan(prev => {
                if (!prev || !prev.scenes[index]) return prev;
                const scenes = [...prev.scenes];
                const targetScene = scenes[index];
                const stableSceneId = targetScene.userProvidedImage?.sceneId || targetScene.userProvidedImage?.id || getSceneDraftId();
                scenes[index] = {
                    ...targetScene,
                    userProvidedImage: {
                        id: stableSceneId,
                        sceneId: stableSceneId,
                        file,
                        previewUrl,
                        thumbnailUrl: previewUrl,
                        base64,
                        mimeType: file.type,
                        type: 'image',
                        duration: targetScene?.estimatedDuration || targetScene?.userProvidedImage?.duration || 3,
                        description: targetScene.visualDescription,
                        imagePrompt: targetScene.imagePrompt,
                        aiFramingMode: presentation.aiFramingMode,
                        aiFramingFocusY: presentation.aiFramingFocusY,
                        aiPresentationReason: presentation.aiPresentationReason,
                    }
                };
                return { ...prev, scenes };
            });
            showNotice('Custom image added. This scene will skip AI generation.', 'info');
        } catch (error) {
            console.error('Plan scene image upload failed', error);
            showNotice('Unable to use that image. Please try again.', 'error');
        }
    };

    const handlePlanSceneImageInput = async (index: number, event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        event.target.value = '';
        if (!file) return;
        await handlePlanSceneImageUpload(index, file);
    };

    const handleRemovePlanSceneImage = (index: number) => {
        setReelPlan(prev => {
            if (!prev || !prev.scenes[index]?.userProvidedImage) return prev;
            const scenes = [...prev.scenes];
            const previewUrl = scenes[index].userProvidedImage?.previewUrl;
            if (previewUrl?.startsWith('blob:')) {
                try { URL.revokeObjectURL(previewUrl); } catch { }
            }
            scenes[index] = { ...scenes[index], userProvidedImage: undefined };
            return { ...prev, scenes };
        });
    };

    const handleAutoDirect = async () => {
        if (!media.length || isAutoDirecting) return;
        setIsAutoDirecting(true);
        try {
            // Fetch scene images as base64 for real visual analysis
            const scenes = await Promise.all(media.map(async (m, i) => {
                let imageBase64 = m.base64 || '';
                // If no base64 cached, try to fetch from previewUrl
                if (!imageBase64 && m.type === 'image' && m.previewUrl) {
                    try {
                        const resp = await fetch(m.previewUrl);
                        const blob = await resp.blob();
                        const reader = new FileReader();
                        imageBase64 = await new Promise<string>((resolve) => {
                            reader.onloadend = () => {
                                const result = reader.result as string;
                                // Strip data URL prefix to get raw base64
                                resolve(result.includes(',') ? result.split(',')[1] : result);
                            };
                            reader.onerror = () => resolve('');
                            reader.readAsDataURL(blob);
                        });
                    } catch { /* fallback to empty */ }
                }
                return {
                    imageBase64,
                    sceneDescription: sceneDrafts[i]?.visualDescription || script?.segments?.[i] || '',
                    sceneIndex: i,
                    totalScenes: media.length,
                };
            }));
            const result = await recommendFullVisualDirection(scenes);
            const { visualSettings: newSettings, sceneKeyframes } = applyVisualDirection(result, visualSettings);
            setVisualSettings({ ...newSettings, sceneKeyframes });
            showNotice(`Auto-Directed: ${result.reasoning}`, 'info');
        } catch (e) {
            showNotice('Auto-Direct failed. Try again or adjust manually.', 'error');
        } finally {
            setIsAutoDirecting(false);
        }
    };

    const handleAutoDirectScene = async (sceneIdx: number) => {
        if (!media.length || isAutoDirecting) return;
        setIsAutoDirecting(true);
        try {
            const m = media[sceneIdx];
            let imageBase64 = m?.base64 || '';
            if (!imageBase64 && m?.type === 'image' && m?.previewUrl) {
                try {
                    const resp = await fetch(m.previewUrl);
                    const blob = await resp.blob();
                    const reader = new FileReader();
                    imageBase64 = await new Promise<string>((resolve) => {
                        reader.onloadend = () => {
                            const result = reader.result as string;
                            resolve(result.includes(',') ? result.split(',')[1] : result);
                        };
                        reader.onerror = () => resolve('');
                        reader.readAsDataURL(blob);
                    });
                } catch { /* fallback */ }
            }

            const scenes = [{
                imageBase64,
                sceneDescription: sceneDrafts[sceneIdx]?.visualDescription || script?.segments?.[sceneIdx] || '',
                sceneIndex: sceneIdx,
                totalScenes: media.length,
            }];
            const result = await recommendFullVisualDirection(scenes);
            const sceneDir = result.scenes[0];
            if (!sceneDir) throw new Error('No direction returned');

            // Update only this scene's override + keyframes
            const currentOverrides = { ...(visualSettings.perSceneOverrides || {}) };
            currentOverrides[sceneIdx] = {
                colorLUT: sceneDir.colorLUT,
                transitionEffect: sceneDir.transitionEffect,
                textAnimation: sceneDir.textAnimation,
                motionBlur: sceneDir.motionBlur,
                chromaticAberration: sceneDir.chromaticAberration,
                perspectiveTilt: sceneDir.perspectiveTilt,
                enableSubjectTracking: sceneDir.enableSubjectTracking,
                enableBeatZoom: sceneDir.enableBeatZoom,
                motionDirection: sceneDir.direction,
                motionIntensity: sceneDir.intensity,
            };

            const currentKeyframes = { ...(visualSettings.sceneKeyframes || {}) };
            if (sceneDir.keyframes && sceneDir.keyframes.length >= 2) {
                currentKeyframes[sceneIdx] = sceneDir.keyframes;
            }

            setVisualSettings({
                ...visualSettings,
                perSceneOverrides: currentOverrides,
                sceneKeyframes: currentKeyframes,
            });
            showNotice(`Scene ${sceneIdx + 1} re-directed: ${sceneDir.reasoning || 'updated'}`, 'info');
        } catch (e) {
            showNotice('Scene re-direct failed. Try again.', 'error');
        } finally {
            setIsAutoDirecting(false);
        }
    };

    const handleDeleteScene = (index: number) => {
        if (!sceneDrafts[index]) return;
        if (confirm('Are you sure you want to delete this scene?')) {
            const removedSceneId = sceneDrafts[index].id;
            
            // 1. Update sceneDrafts and re-number
            setSceneDrafts(prev => prev
                .filter((_, draftIndex) => draftIndex !== index)
                .map((draft, draftIndex) => ({ ...draft, sceneNumber: draftIndex + 1 })));

            // 2. Update media to match
            setMedia(prev => prev.filter((_, mediaIndex) => mediaIndex !== index));

            // 3. Update script: segments, segmentPlans, and derived fields
            setScript(prev => {
                if (!prev) return null;
                const nextSegments = prev.segments.filter((_, i) => i !== index);
                const nextPlans = prev.segmentPlans?.filter((_, i) => i !== index);
                return {
                    ...prev,
                    segments: nextSegments,
                    segmentPlans: nextPlans,
                    hook: nextSegments[0] || '',
                    body: nextSegments.slice(1).join(' '),
                    fullText: nextSegments.join(' '),
                };
            });

            // 4. Update slide durations to match
            setSlideDurations(prev => prev.filter((_, durIndex) => durIndex !== index));

            // 5. Cleanup audio cache
            Object.keys(sceneAudioCacheRef.current).forEach((cacheKey) => {
                if (cacheKey.startsWith(`${removedSceneId}:`)) {
                    delete sceneAudioCacheRef.current[cacheKey];
                }
            });

            // Reset UI states if needed
            showNotice('Scene deleted.', 'info');
        }
    };

    const handleGenerateAudio = async (
        scriptOverride?: ReelScript,
        draftsOverride?: SceneDraft[],
        mediaOverride?: UploadedMedia[],
    ) => {
        const scriptToUse = scriptOverride || script;
        const mediaToUse = mediaOverride || media;
        const currentSceneDrafts = draftsOverride || sceneDrafts;

        if (!scriptToUse) return;
        if (enableVoiceover) {
            const selectedVoice = AVAILABLE_VOICE_OPTIONS.find(v => v.id === selectedVoiceId);
            const needsGeminiKey = selectedVoice?.provider !== 'google';
            if (needsGeminiKey && !hasConfiguredGeminiApiKey()) {
                showNotice('Gemini TTS requires a Gemini API key. Switch to a Google voice or add a key to .env.local.', 'error');
                return;
            }
        }
        const generationRunId = ++audioGenerationRunRef.current;
        const isCurrentGeneration = () => audioGenerationRunRef.current === generationRunId;
        setIsGeneratingAudio(true);
        let ctx: AudioContext | null = null;
        try {
            const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
            if (!AudioContextCtor) {
                throw new Error('Web Audio is not supported in this browser.');
            }
            ctx = new AudioContextCtor();

            let draftsToUse = currentSceneDrafts.length === mediaToUse.length
                ? currentSceneDrafts
                : createSceneDraftsFromMediaAndScript(mediaToUse, scriptToUse);
            const tightenedSceneIndexes = new Set<number>();

            if (enableVoiceover) {
                if (selectedVoiceId === 'Custom') {
                    if (!audioBuffer || audioBuffer.duration < 0.1) {
                        showNotice('No custom voice recording found. Record or upload a voice, or pick a Gemini voice.', 'error');
                        setIsGeneratingAudio(false);
                        setStep(AppStep.ANALYZE_SCRIPT);
                        return;
                    }
                    showNotice('Custom voice recording is attached.', 'info');
                    setStep(AppStep.VIDEO_EXTENSION);
                    setIsGeneratingAudio(false);
                    return;
                }

                setAudioProgress({ completed: 0, total: draftsToUse.length });
                let completedCount = 0;

                const synthesizeSceneVoice = async (draft: SceneDraft): Promise<AudioBuffer> => {
                    const text = getSceneSpokenText(draft);
                    const cacheKey = getSceneVoiceCacheKey(draft, selectedVoiceOption);
                    if (!text) {
                        return ctx!.createBuffer(1, 1, 24000);
                    }
                    let cached = sceneAudioCacheRef.current[cacheKey];
                    if (!cached) {
                        const b64 = await generateVoiceover(text, selectedVoiceOption);
                        if (!b64) {
                            throw new Error(`Voice generation failed for scene ${draft.sceneNumber}. Empty audio returned.`);
                        }
                        const decoded = await decodeAudioData(b64, ctx!);
                        cached = trimAudioSilence(decoded, ctx!);
                        if (!cached || cached.duration < 0.05) {
                            throw new Error(`Voice generation failed for scene ${draft.sceneNumber}. Audio was too short.`);
                        }
                        sceneAudioCacheRef.current[cacheKey] = cached;
                    }
                    return cached;
                };

                // Parallel TTS (bounded) — cuts wall-clock vs sequential scene loop.
                let segmentBuffers = await mapPool<SceneDraft, AudioBuffer>(draftsToUse, 3, async (draft) => {
                    const segmentBuffer = await synthesizeSceneVoice(draft);
                    completedCount += 1;
                    if (isCurrentGeneration()) {
                        setAudioProgress({ completed: completedCount, total: draftsToUse.length });
                    }
                    return segmentBuffer;
                });
                if (!isCurrentGeneration()) return;

                let { combinedBuffer, segmentDurations } = concatenateAudioBuffers(segmentBuffers, ctx);
                const spokenSceneCount = draftsToUse.filter((d) => getSceneSpokenText(d)).length;
                if (spokenSceneCount > 0 && combinedBuffer.duration < 0.1) {
                    throw new Error('Voiceover combined to near-silence. Regenerate voice or try another voice.');
                }

                const effectiveTarget = resolveEffectiveTargetDuration(targetDuration);
                const planTargets = resolveVoiceTimelineTargets(draftsToUse, effectiveTarget);
                let reconciledDrafts = draftsToUse.map((draft, index) => ({
                    ...draft,
                    requestedDurationSec: planTargets[index] ?? draft.requestedDurationSec,
                }));
                let assessment = assessMeasuredNarrationFeasibility(
                    reconciledDrafts.map((draft) => ({
                        requestedDurationSec: draft.requestedDurationSec,
                        sceneNumber: draft.sceneNumber,
                        pacingRole: draft.pacingRole,
                        pacingLocked: draft.pacingLocked,
                        scriptGuidance: draft.voiceoverText || draft.onScreenText || draft.visualDescription,
                    })),
                    segmentDurations,
                    effectiveTarget || segmentDurations.reduce((sum, value) => sum + (value || 0), 0),
                );

                // One measured correction pass. Unaffected scene buffers are retained,
                // and changed text receives a new cache key, so only corrected lines
                // invoke TTS again.
                if (
                    effectiveTarget > 0
                    && assessment.feasibility === 'impossible'
                    && assessment.constraint === 'measured_overflow'
                ) {
                    setGenerationStatusText('Tightening measured narration once…');
                    const measuredFit = await fitSceneScriptsToMeasuredDurations(
                        reconciledDrafts.map((draft) => ({
                            voiceoverText: draft.voiceoverText,
                            onScreenText: draft.onScreenText,
                            requestedDurationSec: draft.requestedDurationSec,
                            visualDescription: draft.visualDescription,
                            sceneNumber: draft.sceneNumber,
                            pacingLocked: draft.pacingLocked,
                        })),
                        segmentDurations,
                        effectiveTarget,
                    );
                    if (!isCurrentGeneration()) return;

                    const changedIndexes = measuredFit.changedIndexes.filter((index) => {
                        const candidate = measuredFit.lines[index];
                        return Boolean(candidate && candidate !== getSceneSpokenText(reconciledDrafts[index]));
                    });
                    if (changedIndexes.length > 0) {
                        const changedSet = new Set(changedIndexes);
                        const candidateDrafts = reconciledDrafts.map((draft, index) => {
                            if (!changedSet.has(index)) return draft;
                            const spokenField = draft.voiceoverText?.trim() ? 'voiceoverText' : 'onScreenText';
                            return applySceneTextEdit(draft, measuredFit.lines[index], spokenField);
                        });
                        try {
                            completedCount = 0;
                            setAudioProgress({ completed: 0, total: changedIndexes.length });
                            const regenerated = await mapPool<number, { index: number; buffer: AudioBuffer }>(
                                changedIndexes,
                                3,
                                async (index) => {
                                    const buffer = await synthesizeSceneVoice(candidateDrafts[index]);
                                    completedCount += 1;
                                    if (isCurrentGeneration()) {
                                        setAudioProgress({ completed: completedCount, total: changedIndexes.length });
                                    }
                                    return { index, buffer };
                                },
                            );
                            if (!isCurrentGeneration()) return;
                            const nextBuffers = [...segmentBuffers];
                            regenerated.forEach(({ index, buffer }) => {
                                nextBuffers[index] = buffer;
                            });
                            segmentBuffers = nextBuffers;
                            reconciledDrafts = candidateDrafts;
                            draftsToUse = reconciledDrafts;
                            changedIndexes.forEach((index) => tightenedSceneIndexes.add(index));
                            ({ combinedBuffer, segmentDurations } = concatenateAudioBuffers(segmentBuffers, ctx!));
                            assessment = assessMeasuredNarrationFeasibility(
                                reconciledDrafts.map((draft) => ({
                                    requestedDurationSec: draft.requestedDurationSec,
                                    sceneNumber: draft.sceneNumber,
                                    pacingRole: draft.pacingRole,
                                    pacingLocked: draft.pacingLocked,
                                    scriptGuidance: draft.voiceoverText || draft.onScreenText || draft.visualDescription,
                                })),
                                segmentDurations,
                                effectiveTarget,
                            );
                        } catch (correctionVoiceError) {
                            console.warn('Measured narration retry failed; preserving original clean voice', correctionVoiceError);
                        }
                    }
                }

                if (!isCurrentGeneration()) return;
                generatedVoiceSyncSignatureRef.current = buildVoiceSyncSignature(reconciledDrafts, selectedVoiceOption);
                setAudioBuffer(combinedBuffer);
                setAudioSegmentDurations(segmentDurations);
                const timelineTargets = assessment.reconciledSlots;
                setSlideDurations(timelineTargets);

                let voiceOverrunCount = 0;
                const finalDrafts = reconciledDrafts.map((draft, index) => {
                    const targetSec = clampSceneDuration(timelineTargets[index] || draft.requestedDurationSec);
                    const voiceSec = segmentDurations[index] || 0;
                    const textHash = getSceneVoiceCacheKey(draft, selectedVoiceOption).split(':').slice(3).join(':');
                    const hasText = Boolean(getSceneSpokenText(draft));
                    const voiceOk = !hasText || voiceSec >= 0.05;
                    const voiceOverrunsSlot = hasText && voiceOk && voiceSec > targetSec + 0.05;
                    if (voiceOverrunsSlot) voiceOverrunCount += 1;
                    return {
                        ...draft,
                        requestedDurationSec: targetSec,
                        resolvedDurationSec: targetSec,
                        voiceAsset: hasText && voiceOk ? {
                            provider: selectedVoiceOption.provider,
                            voiceId: selectedVoiceOption.id,
                            textHash,
                            durationSec: voiceSec,
                        } : undefined,
                        generationStatus: {
                            ...draft.generationStatus,
                            voice: hasText && voiceOk
                                ? (voiceOverrunsSlot ? 'stale' as const : 'clean' as const)
                                : (hasText ? 'error' as const : draft.generationStatus.voice),
                        },
                    };
                });
                setSceneDrafts(finalDrafts);
                setScript(deriveScriptFromSceneDrafts(scriptToUse, finalDrafts));
                if (assessment.feasibility === 'impossible') {
                    const tightenedPrefix = tightenedSceneIndexes.size > 0
                        ? `Finalize tightened ${tightenedSceneIndexes.size} spoken line${tightenedSceneIndexes.size === 1 ? '' : 's'}, but `
                        : '';
                    const offenderLabels = assessment.offendingScenes
                        .slice(0, 3)
                        .map((scene) => `scene ${scene.sceneNumber}`)
                        .join(', ');
                    const impossibleMessage = assessment.constraint === 'locked_constraints'
                        ? `Locked timing prevents clean narration from fitting. Unlock ${offenderLabels || 'the affected scenes'} and fit again; audio and locked durations were preserved.`
                        : `${tightenedPrefix}clean narration still needs ${assessment.measuredMinimumSec.toFixed(1)}s for a ${effectiveTarget}s target. `
                            + `${offenderLabels ? `Shorten ${offenderLabels}, ` : 'Shorten the spoken lines, '}`
                            + 'or raise the target; audio was preserved without compression.';
                    showNotice(impossibleMessage, 'error');
                } else if (voiceOverrunCount > 0) {
                    showNotice(
                        `${voiceOverrunCount} locked scene${voiceOverrunCount === 1 ? '' : 's'} are shorter than their voice. Unlock and fit the timeline, or shorten the script and regenerate.`,
                        'error',
                    );
                } else if (tightenedSceneIndexes.size > 0) {
                    showNotice(
                        `Finalize tightened ${tightenedSceneIndexes.size} spoken line${tightenedSceneIndexes.size === 1 ? '' : 's'} to fit the ${effectiveTarget}s target.`,
                        'info',
                    );
                }
            } else {
                invalidateGeneratedVoicePreview();
                const segmentDurations = draftsToUse.map((draft) => clampSceneDuration(draft.requestedDurationSec));
                setSlideDurations(segmentDurations);
                const finalDrafts = draftsToUse.map((draft) => ({
                    ...draft,
                    resolvedDurationSec: clampSceneDuration(draft.requestedDurationSec),
                }));
                setSceneDrafts(finalDrafts);
            }
            setStep(AppStep.VIDEO_EXTENSION);
        } catch (e) {
            if (!isCurrentGeneration()) return;
            if (isGeminiTtsQuotaError(e)) {
                showNotice(getGeminiTtsQuotaMessage(e), 'error');
            } else {
                handleError(e, "Audio Generation");
            }
            setSceneDrafts(prev => prev.length ? prev : createSceneDraftsFromMediaAndScript(mediaToUse, scriptToUse));
            // Stay on Script Studio so the user can retry — do not silently advance.
            setStep(AppStep.ANALYZE_SCRIPT);
        } finally {
            if (isCurrentGeneration()) {
                setIsGeneratingAudio(false);
                setAudioProgress({ completed: 0, total: 0 });
            }
            // Keep AudioContext alive; closing can invalidate decoded buffers in some browsers.
            ctx = null;
        }
    };

    const handleUpdateClipDuration = (index: number, newDuration: number) => {
        let flaggedStale = false;
        setSceneDrafts(prev => prev.map((draft, draftIndex) => {
            if (draftIndex !== index) return draft;
            const nextDraft = applySceneDurationEdit(draft, newDuration);
            flaggedStale = nextDraft.generationStatus.voice === 'stale';
            return nextDraft;
        }));
        if (flaggedStale) {
            showNotice('That scene is now shorter than its generated voice. Rewrite to fit or regenerate voice.', 'info');
        }
    };

    const handleGenerateMusic = async () => {
        setIsGeneratingMusic(true);
        try {
            const comp = await composeMusic(script?.musicSuggestion?.mood || '', 'Fusion', media.map(m => m.description).join(' '), customMusicPrompt);
            const buf = await synthesizeComposition(comp);
            const metadata = extractMusicMetadata(buf);
            const analysis = await analyzeMusicMood(metadata, script?.fullText || userPrompt);
            const track: GeneratedMusicTrack = {
                id: Date.now().toString(),
                name: comp.trackName || 'AI Track',
                buffer: buf,
                description: analysis.vibe || customMusicPrompt,
                createdAt: Date.now(),
                origin: 'generated',
                analysis
            };
            setMusicHistory(prev => [track, ...prev]);
            setBgMusicBuffer(buf);
            setSelectedTrackId(track.id);
            setUploadedMusicAnalysis(analysis);
            setMusicVibeDescription(analysis.vibe);
        } catch (e) { handleError(e, "Music Composition"); }
        setIsGeneratingMusic(false);
    };

    const handleToggleMusicPreview = () => {
        const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
        if (isPlayingMusicPreview) {
            if (musicPreviewSource.current) musicPreviewSource.current.stop();
            setIsPlayingMusicPreview(false);
        } else {
            if (!bgMusicBuffer) return;
            const src = audioCtx.createBufferSource();
            src.buffer = bgMusicBuffer; src.loop = true;
            src.connect(audioCtx.destination); src.start();
            musicPreviewSource.current = src; setIsPlayingMusicPreview(true);
        }
    };

    const handleRegeneratePlan = () => {
        if (!regenFeedback.trim()) return;
        const feedback = regenFeedback.trim();
        setRegenFeedback('');
        setIsRegenerating(true);
        handleGeneratePlan(undefined, true, feedback);
    };

    const handleUpdateScene = (index: number, field: 'visualDescription' | 'imagePrompt' | 'scriptGuidance', value: string) => {
        if (!reelPlan) return;
        const newScenes = [...reelPlan.scenes];
        newScenes[index] = { ...newScenes[index], [field]: value };
        setReelPlan({ ...reelPlan, scenes: newScenes });
    };

    const handleDeleteSceneFromPlan = (index: number) => {
        if (!reelPlan || reelPlan.scenes.length <= 2) {
            showNotice('Need at least 2 scenes for a reel', 'error');
            return;
        }
        const newScenes = reelPlan.scenes.filter((_, i) => i !== index).map((scene, i) => ({
            ...scene,
            sceneNumber: i + 1
        }));
        setReelPlan({ ...reelPlan, scenes: newScenes });
        const aiCount = newScenes.filter(scene => !scene.userProvidedImage).length;
        showNotice(`Scene deleted.Now ${newScenes.length} scenes(${aiCount} AI images = $${estimateImageCost(aiCount)})`, 'info');
    };

    // Cost estimation helper
    const estimateImageCost = (sceneCount: number) => (sceneCount * 0.03).toFixed(2);

    const handleReopenPlan = (entry: ReelHistoryEntry) => {
        try {
            // Check if this is a project session (autosaved) or reel history entry
            const isProjectSession = entry.metadata?.isProjectSession;

            // For project sessions, we may not have a plan but still have useful state
            if (!entry.metadata?.plan && !isProjectSession) {
                alert('Plan data is missing for this entry.');
                return;
            }

            // Restore plan if available
            const plan = entry.metadata?.plan as ReelPlan | undefined;
            if (plan) {
                setReelPlan(plan);
            }

            setCreationMode((entry.metadata?.creationMode as CreationMode) || CreationMode.TEXT_TO_REEL);
            if (entry.metadata?.selectedVoiceId || entry.metadata?.selectedVoice) {
                setSelectedVoiceId((entry.metadata.selectedVoiceId || entry.metadata.selectedVoice) as string);
            }
            if (typeof entry.metadata?.enableVoiceover === 'boolean') {
                setEnableVoiceover(entry.metadata.enableVoiceover);
            }
            if (typeof entry.metadata?.enableCaptions === 'boolean') {
                setEnableCaptions(entry.metadata.enableCaptions);
            }
            if (entry.metadata?.brandKit && typeof entry.metadata.brandKit === 'object') {
                setBrandKit(prev => ({ ...prev, ...(entry.metadata!.brandKit as BrandKit) }));
            }

            // Restore script if available
            const savedScript = entry.metadata?.script as ReelScript | undefined;
            if (savedScript && plan?.scenes && plan.scenes.length > 0) {
                const resizedScenes = savedScript.segments.slice(0, plan.scenes.length);
                setScript({
                    ...savedScript,
                    segments: resizedScenes.length === plan.scenes.length
                        ? resizedScenes
                        : [
                            ...resizedScenes,
                            ...Array.from({ length: plan.scenes.length - resizedScenes.length }, () => '')
                        ],
                });
            } else if (savedScript) {
                setScript(savedScript);
            } else {
                setScript(null);
            }

            // Restore prompt if available
            if (entry.prompt) {
                setUserPrompt(entry.prompt);
            }

            // Restore Song to Video state if available
            if (entry.metadata?.songToVideoState) {
                setSongToVideoState(entry.metadata.songToVideoState as SongToVideoState);
                setCreationMode(CreationMode.SONG_TO_VIDEO);
                setStep(AppStep.SONG_VIDEO_ASSEMBLY); // Or whatever step makes sense to resume to
            }

            // Restore topic if available (for text-to-reel mode)
            if (entry.topic) {
                setTextToReelTopic(entry.topic);
            }

            // Restore visual settings from project session
            if (entry.metadata?.visualSettings) {
                setVisualSettings(prev => ({ ...prev, ...entry.metadata!.visualSettings }));
            }

            // Restore subtitle settings from project session (with safe defaults for new properties)
            if (entry.metadata?.subtitleSettings) {
                const savedSubs = entry.metadata.subtitleSettings as Partial<SubtitleSettings>;
                setSubtitleSettings(prev => ({
                    ...prev,
                    ...savedSubs,
                    // Ensure new properties have defaults if not in saved data
                    displayMode: savedSubs.displayMode || prev.displayMode || 'sentence',
                    fillColor: savedSubs.fillColor || savedSubs.color || prev.fillColor || '#FFFFFF',
                    outlineColor: savedSubs.outlineColor || prev.outlineColor || '#000000',
                    highlightColor: savedSubs.highlightColor || prev.highlightColor || '#FFFF00',
                    glowColor: savedSubs.glowColor || prev.glowColor || '#00FFFF',
                    backgroundShape: savedSubs.backgroundShape || prev.backgroundShape || 'none',
                    strokeWidth: savedSubs.strokeWidth ?? prev.strokeWidth ?? 6,
                }));
            }

            // Restore audio mix from project session
            if (entry.metadata?.audioMix) {
                setAudioMix(prev => ({ ...prev, ...entry.metadata!.audioMix }));
            }

            if (entry.metadata?.sceneDrafts && Array.isArray(entry.metadata.sceneDrafts) && entry.metadata.sceneDrafts.length > 0) {
                const restoredMedia = entry.metadata?.media && Array.isArray(entry.metadata.media)
                    ? restorePersistedMediaItems(entry.metadata.media as Array<Partial<UploadedMedia>>)
                    : [];
                const restored = restorePersistedSceneDrafts(
                    entry.metadata.sceneDrafts as Array<Partial<SceneDraft>>,
                    restoredMedia,
                );
                // Voice buffers are not persisted — mark prior VO as stale so preview isn't silently mute.
                const draftsNeedingVoice = restored.drafts.map((draft) => (
                    draft.voiceAsset || draft.generationStatus.voice === 'clean'
                        ? {
                            ...draft,
                            generationStatus: {
                                ...draft.generationStatus,
                                voice: 'stale' as const,
                            },
                        }
                        : draft
                ));
                setMedia(restored.media);
                setSlideDurations(restored.media.map(m => m.duration || 3));
                setSceneDrafts(draftsNeedingVoice);
                setAudioBuffer(null);
                const resumeStep = (entry.metadata?.step as AppStep | undefined);
                const safeResume =
                    resumeStep === AppStep.PREVIEW ||
                    resumeStep === AppStep.VIDEO_EXTENSION ||
                    resumeStep === AppStep.EXPORT
                        ? AppStep.ANALYZE_SCRIPT
                        : (resumeStep && Object.values(AppStep).includes(resumeStep)
                            ? resumeStep
                            : AppStep.ANALYZE_SCRIPT);
                setStep(safeResume);
                showNotice(
                    draftsNeedingVoice.some((d) => d.generationStatus.voice === 'stale')
                        ? `Loaded project: ${entry.metadata?.sessionName || entry.metadata?.title || 'Untitled'}. Regenerate voice to hear narration.`
                        : `Loaded project: ${entry.metadata?.sessionName || entry.metadata?.title || 'Untitled'}`,
                    'info',
                );
                setShowProjects(false);
                return;
            }

            // Restore media from metadata if available
            if (entry.metadata?.media && Array.isArray(entry.metadata.media) && entry.metadata.media.length > 0) {
                const savedMedia = entry.metadata.media as Array<{
                    id?: string;
                    src?: string;
                    previewUrl?: string;
                    thumbnail?: string;
                    thumbnailUrl?: string;
                    name?: string;
                    duration?: number;
                    type?: string;
                    mimeType?: string;
                }>;

                const restoredMedia: UploadedMedia[] = restorePersistedMediaItems(savedMedia as Array<Partial<UploadedMedia>>);

                setMedia(restoredMedia);
                setSlideDurations(restoredMedia.map(m => m.duration || 3));
                setSceneDrafts(createSceneDraftsFromMediaAndScript(restoredMedia, savedScript || null));
                setStep(AppStep.ANALYZE_SCRIPT);
                showNotice(`Loaded project: ${entry.metadata?.title || 'Untitled'}`, 'info');
                setShowProjects(false);
                return;
            }

            // Determine best step based on what data we have
            const hasScript = !!entry.metadata?.script;
            const hasPlan = !!entry.metadata?.plan;
            const hasSongToVideoState = !!entry.metadata?.songToVideoState;

            if (hasSongToVideoState) {
                setStep(AppStep.SONG_VIDEO_ASSEMBLY);
            } else if (hasScript) {
                setStep(AppStep.ANALYZE_SCRIPT);
            } else if (hasPlan) {
                setStep(AppStep.REVIEW_PLAN);
            } else {
                // For project sessions without plan/script, go to appropriate starting point
                const mode = entry.metadata?.creationMode as CreationMode;
                if (mode === CreationMode.TEXT_TO_REEL) {
                    setStep(AppStep.TOPIC_INPUT);
                } else {
                    setStep(AppStep.UPLOAD);
                }
            }
            showNotice(`Loaded project: ${entry.metadata?.title || 'Untitled'}`, 'info');
            setShowProjects(false);
        } catch (error) {
            console.error('Error restoring project:', error);
            showNotice('Failed to restore project. Please try again.', 'error');
        }
    };

    const handleApproveAndGenerateImages = async () => {
        if (!reelPlan) return;
        setStep(AppStep.GENERATING_ASSETS);
        setGenerationStep(4); setGenerationStatusText('Creating visual assets...');
        setGeneratedImagesCount(0);
        try {
            const catalogEntries = brandAssetCatalog.length ? brandAssetCatalog : (brandKit.assetCatalog || []);
            const FAILED_SCENE_PLACEHOLDER =
                'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==';

            // Always lock scene durations to the topic-screen target (role-weighted).
            const effectiveTarget = resolveEffectiveTargetDuration(targetDuration) || sumSceneDurations(reelPlan.scenes) || 30;
            const normalizedPlan = normalizePlanDurations(reelPlan, effectiveTarget);
            if (normalizedPlan !== reelPlan) {
                setReelPlan(normalizedPlan);
            }
            const planScenes = normalizedPlan.scenes;

            const preparedScenes = await mapPool<ScenePlan, { media: UploadedMedia; draft: SceneDraft }>(
                planScenes,
                3,
                async (scene, idx) => {
                const requestedDuration = clampSceneDuration(scene.estimatedDuration || 3);
                const sceneId = scene.userProvidedImage?.sceneId || getSceneDraftId();
                const storyboardMetadata = extractApprovedStoryboardMetadata(scene);
                const catalogEntry = typeof scene.brandImageIndex === 'number'
                    ? (
                        catalogEntries.find((entry) => entry.imageIndex === scene.brandImageIndex)
                        || catalogEntries.find((entry) => entry.assetId === scene.storyboardBaseAssetId)
                        || catalogEntries[scene.brandImageIndex]
                    )
                    : catalogEntries.find((entry) => entry.assetId === scene.storyboardBaseAssetId);

                if (scene.userProvidedImage) {
                    const previewUrl = scene.userProvidedImage.previewUrl || toDataUrl(scene.userProvidedImage.base64, scene.userProvidedImage.mimeType);
                    const mediaItem: UploadedMedia = {
                        ...scene.userProvidedImage,
                        id: sceneId,
                        sceneId,
                        previewUrl,
                        thumbnailUrl: scene.userProvidedImage.thumbnailUrl || previewUrl,
                        description: scene.visualDescription,
                        imagePrompt: scene.imagePrompt,
                        duration: scene.userProvidedImage.duration || requestedDuration,
                        extendedDuration: scene.userProvidedImage.duration || requestedDuration,
                        assetOrigin: 'user_upload',
                        brandAssetId: catalogEntry?.assetId,
                        aiFramingMode: scene.userProvidedImage.aiFramingMode,
                        aiFramingFocusY: scene.userProvidedImage.aiFramingFocusY,
                        aiPresentationReason: scene.userProvidedImage.aiPresentationReason,
                        ...storyboardMetadata,
                    };
                    setGeneratedImagesCount(prev => prev + 1);
                    const draft = createSceneDraftFromPlanScene({
                        ...scene,
                        userProvidedImage: mediaItem,
                    }, idx, planScenes.length);
                    return {
                        media: mediaItem,
                        draft: {
                            ...draft,
                            id: sceneId,
                            sceneNumber: idx + 1,
                            brandAssetId: catalogEntry?.assetId,
                            imageSource: 'uploaded',
                            generationStatus: {
                                ...draft.generationStatus,
                                image: 'clean',
                            },
                        },
                    };
                }

                let primaryReference: { data: string; mimeType?: string; assetId?: string } | undefined;
                let imageSource: SceneDraft['imageSource'] = 'generated';
                if (
                    typeof scene.brandImageIndex === 'number' &&
                    brandKit.productImages &&
                    brandKit.productImages[scene.brandImageIndex]
                ) {
                    const brandAsset = brandKit.productImages[scene.brandImageIndex];
                    const shouldUseExactBrandAsset = shouldPreferExactBrandAssetScene(scene, catalogEntry);
                    if (shouldUseExactBrandAsset) {
                        setGeneratedImagesCount(prev => prev + 1);
                        const previewUrl = brandAsset.previewUrl || toDataUrl(brandAsset.base64, brandAsset.mimeType);
                        const mediaItem: UploadedMedia = {
                            id: sceneId,
                            sceneId,
                            file: brandAsset.file || new File([], `brand_asset_${scene.brandImageIndex}.jpg`),
                            previewUrl,
                            thumbnailUrl: previewUrl,
                            type: 'image',
                            base64: brandAsset.base64,
                            mimeType: brandAsset.mimeType,
                        duration: requestedDuration,
                        extendedDuration: requestedDuration,
                        description: scene.visualDescription,
                        imagePrompt: scene.imagePrompt,
                        assetOrigin: 'brand_asset',
                        brandAssetId: catalogEntry?.assetId,
                        aiFramingMode: catalogEntry?.framingMode,
                        aiFramingFocusY: catalogEntry?.framingFocusY,
                        aiPresentationReason: catalogEntry?.presentationReason,
                        ...storyboardMetadata,
                    };
                        const draft = createSceneDraftFromPlanScene({
                            ...scene,
                            userProvidedImage: mediaItem,
                        }, idx, planScenes.length);
                        return {
                            media: mediaItem,
                            draft: {
                                ...draft,
                                id: sceneId,
                                sceneNumber: idx + 1,
                                brandAssetId: catalogEntry?.assetId,
                                imageSource: 'brand_asset',
                                generationStatus: {
                                    ...draft.generationStatus,
                                    image: 'clean',
                                },
                            },
                        };
                    } else {
                        primaryReference = {
                            data: brandAsset.base64,
                            mimeType: brandAsset.mimeType,
                            assetId: catalogEntry?.assetId,
                        };
                        imageSource = 'brand_edit';
                    }
                }

                try {
                    const base64 = await generateImageAsset({
                        mode: primaryReference ? 'edit' : 'generate',
                        imagePrompt: scene.imagePrompt,
                        visualDescription: scene.visualDescription,
                        currentSceneText: scene.scriptGuidance || '',
                        brandContext: [
                            catalogEntry?.productIdentity,
                            catalogEntry?.semanticDescription,
                            brandKit.visualSignature,
                            brandKit.aestheticAnalysis,
                            catalogEntry?.productIdentity ? `Preserve the real product: ${catalogEntry.productIdentity}. Keep all labels, logos, and packaging exactly as-is.` : 'Preserve all product labels, logos, and packaging exactly as-is.',
                        ].filter(Boolean).join(' | '),
                        primaryReference,
                        // Eco Mode skips the extra TEXT_MODEL prompt-review call per scene.
                        skipPromptReview: ecoMode,
                    });
                    setGeneratedImagesCount(prev => prev + 1);
                    const generatedPreviewUrl = toDataUrl(base64, 'image/png') || '';
                    const mediaItem: UploadedMedia = {
                        id: sceneId,
                        sceneId,
                        file: new File([], `scene_${scene.sceneNumber}.png`),
                        previewUrl: generatedPreviewUrl,
                        thumbnailUrl: generatedPreviewUrl,
                        type: 'image',
                        base64,
                        mimeType: 'image/png',
                        duration: requestedDuration,
                        extendedDuration: requestedDuration,
                        description: scene.visualDescription,
                        imagePrompt: scene.imagePrompt,
                        assetOrigin: imageSource === 'brand_edit' ? 'brand_edit' : 'generated',
                        brandAssetId: catalogEntry?.assetId,
                        aiFramingMode: imageSource === 'brand_edit' ? catalogEntry?.framingMode : undefined,
                        aiFramingFocusY: imageSource === 'brand_edit' ? catalogEntry?.framingFocusY : undefined,
                        aiPresentationReason: imageSource === 'brand_edit' ? catalogEntry?.presentationReason : undefined,
                        ...storyboardMetadata,
                    };
                    const draft = createSceneDraftFromPlanScene(scene, idx, planScenes.length);
                    return {
                        media: mediaItem,
                        draft: {
                            ...draft,
                            id: sceneId,
                            sceneNumber: idx + 1,
                            brandAssetId: catalogEntry?.assetId,
                            imageSource,
                            media: mediaItem,
                            generationStatus: {
                                ...draft.generationStatus,
                                image: 'clean',
                            },
                        },
                    };
                } catch (sceneErr) {
                    console.error(`[handleApproveAndGenerateImages] Scene ${idx + 1} failed:`, sceneErr);
                    // Keep the scene slot so the storyboard length stays intact.
                    const draft = createSceneDraftFromPlanScene(scene, idx, planScenes.length);
                    const mediaItem: UploadedMedia = {
                        id: sceneId,
                        sceneId,
                        file: new File([], `scene_${scene.sceneNumber}_failed.png`),
                        previewUrl: FAILED_SCENE_PLACEHOLDER,
                        thumbnailUrl: FAILED_SCENE_PLACEHOLDER,
                        type: 'image',
                        mimeType: 'image/png',
                        duration: requestedDuration,
                        extendedDuration: requestedDuration,
                        description: scene.visualDescription,
                        imagePrompt: scene.imagePrompt,
                        assetOrigin: 'generated',
                        ...storyboardMetadata,
                    };
                    return {
                        media: mediaItem,
                        draft: {
                            ...draft,
                            id: sceneId,
                            sceneNumber: idx + 1,
                            media: mediaItem,
                            generationStatus: {
                                ...draft.generationStatus,
                                image: 'error' as const,
                            },
                        },
                    };
                }
            });
            const failedCount = preparedScenes.filter((entry) => entry.draft.generationStatus.image === 'error').length;
            if (failedCount > 0) {
                showNotice(`${failedCount} scene(s) failed image generation — placeholders kept so you can retry from Script Studio.`, 'warning');
            }
            let preparedMedia = preparedScenes.map((entry) => entry.media);
            let preparedDrafts = preparedScenes.map((entry) => entry.draft);
            if (preparedMedia.length === 0) throw new Error("Asset generation failed");

            const finalOutputReview = reviewGeneratedSceneOutputs(
                {
                    rawPrompt: textToReelTopic,
                    adFormat: 'stitched_video',
                    platform: 'tiktok',
                    objective: 'awareness',
                    durationSec: clampDurationValue(targetDuration) as 10 | 15 | 20 | 30 | 45 | 60,
                    executionMode: 'balanced',
                    productUrl: brandKit.websiteUrl,
                },
                preparedDrafts,
                brandKit.productImages?.length || 0,
            );

            if (finalOutputReview?.metadata?.failingSceneNumbers?.length && brandKit.productImages?.length) {
                const failingScenes = new Set(finalOutputReview.metadata.failingSceneNumbers);
                const corrected = preparedDrafts.map((draft, index) => {
                    if (!failingScenes.has(draft.sceneNumber)) {
                        return { draft, media: preparedMedia[index] };
                    }

                    // Never overwrite a user-uploaded image with a brand asset fallback
                    if (draft.imageSource === 'uploaded') {
                        return { draft, media: preparedMedia[index] };
                    }

                    const fallbackIndex = typeof draft.brandImageIndex === 'number'
                        ? Math.min(draft.brandImageIndex, brandKit.productImages!.length - 1)
                        : Math.min(index, brandKit.productImages!.length - 1);
                    const fallbackAsset = brandKit.productImages![fallbackIndex] || brandKit.productImages![0];
                    const correctedMedia = createExactBrandMedia(
                        draft.id,
                        draft,
                        fallbackAsset,
                        draft.brandAssetId || brandAssetCatalog[fallbackIndex]?.assetId,
                        brandAssetCatalog[fallbackIndex],
                    );

                    return {
                        media: correctedMedia,
                        draft: {
                            ...draft,
                            imageSource: 'brand_asset' as const,
                            brandAssetEditAction: 'use_as_is' as const,
                            brandAssetId: correctedMedia.brandAssetId,
                            media: correctedMedia,
                            generationStatus: {
                                ...draft.generationStatus,
                                image: 'clean' as const,
                            },
                        },
                    };
                });

                preparedDrafts = corrected.map((entry) => entry.draft);
                preparedMedia = corrected.map((entry) => entry.media);
                showNotice(`Output QA corrected ${failingScenes.size} scene${failingScenes.size === 1 ? '' : 's'} to real product assets to keep the ad on-brand.`, 'info');
            }

            // Storytelling feel: next shot slides over the previous (not random hard cuts).
            preparedMedia = preparedMedia.map((item) => ({
                ...item,
                transitionEffect: item.transitionEffect || 'slide',
            }));
            preparedDrafts = preparedDrafts.map((draft, index) => ({
                ...draft,
                media: {
                    ...(draft.media || preparedMedia[index]),
                    transitionEffect: draft.media?.transitionEffect || preparedMedia[index]?.transitionEffect || 'slide',
                },
            }));
            setVisualSettings((prev) => ({
                ...prev,
                transitionEffect: prev.transitionEffect && prev.transitionEffect !== 'none'
                    ? prev.transitionEffect
                    : 'slide',
                motionDirection: prev.motionDirection === 'random' || !prev.motionDirection
                    ? 'zoom-in'
                    : prev.motionDirection,
            }));

            setSceneDrafts(preparedDrafts);
            setMedia(preparedMedia);
            setSlideDurations(deriveSlideDurationsFromSceneDrafts(preparedDrafts));
            setGenerationStep(5); setGenerationStatusText('Generating viral script...');
            logReelHistory('assets_generated', {
                metadata: {
                    generatedCount: preparedMedia.length,
                    providedCount: providedScenesCount,
                    media: preparedMedia.map((m, index) => ({
                        id: `scene - ${index} `,
                        src: m.previewUrl,
                        thumbnail: m.thumbnailUrl || m.previewUrl,
                        name: m.description || `Scene ${index + 1} `,
                        duration: m.duration
                    }))
                }
            });
            await handleScriptGeneration(preparedMedia, preparedDrafts);
        } catch (e) {
            handleError(e, "Image Generation");
            logReelHistory('error', {
                metadata: { stage: 'asset_generation', error: (e as Error)?.message }
            });
            setStep(AppStep.REVIEW_PLAN);
        }
    };
    handleApproveRef.current = handleApproveAndGenerateImages;

    const handleMusicUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files || e.target.files.length === 0) return;
        const file = e.target.files[0];
        e.target.value = '';
        setPreUploadedMusic(file);
        setIsAnalyzingMusic(true);
        try {
            const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
            const arrayBuffer = await file.arrayBuffer();
            const audioBuf = await ctx.decodeAudioData(arrayBuffer);
            const metadata = extractMusicMetadata(audioBuf);
            const analysis = await analyzeMusicMood(metadata, script?.fullText || userPrompt);
            const track: GeneratedMusicTrack = {
                id: `uploaded - ${Date.now()} `,
                name: file.name || 'Uploaded Track',
                buffer: audioBuf,
                description: analysis.vibe,
                createdAt: Date.now(),
                origin: 'uploaded',
                analysis
            };
            setMusicHistory(prev => [track, ...prev]);
            setBgMusicBuffer(audioBuf);
            setSelectedTrackId(track.id);
            setUploadedMusicAnalysis(analysis);
            setMusicVibeDescription(analysis.vibe);
        } catch (err) {
            console.error('Music upload failed', err);
            alert('Unable to analyze this audio. Please try another track.');
        } finally {
            setIsAnalyzingMusic(false);
        }
    };

    // --- RENDER ---
    const heroCtaButtonClass = "px-8 py-4 rounded-2xl border border-white/15 text-white font-semibold flex items-center justify-center gap-3 bg-white/10 hover:bg-white/20 transition";

    return (
        <div className="min-h-screen bg-dark-bg text-white font-sans pb-10">
                <header className="h-16 border-b border-dark-border flex items-center px-6 justify-between bg-dark-bg/90 backdrop-blur z-50 sticky top-0">
                <div className="flex items-center gap-2 cursor-pointer" onClick={handleStartOver}>
                    <div className="w-6 h-6 rounded bg-gradient-to-br from-insta-start to-insta-purple"></div>
                    <h1 className="font-bold text-lg">ReelAI Studio</h1>
                </div>
                <div className="flex items-center gap-3">
                    {step !== AppStep.LANDING && (
                        <>
                            <span className="text-xs font-mono text-gray-500">{step}</span>
                            {lastAutosave && (
                                <span className="text-[10px] text-gray-600">
                                    💾 {new Date(lastAutosave).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                </span>
                            )}
                            <button
                                onClick={() => setShowUsageStats(true)}
                                className="px-4 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 transition text-sm font-semibold flex items-center gap-2"
                                title="View API Usage & Costs"
                            >
                                💰 Usage
                            </button>
                        </>
                    )}
                    <button
                        onClick={() => setShowProjects(true)}
                        className="px-3.5 py-2 rounded-xl border border-white/10 text-xs uppercase tracking-widest text-white/60 hover:text-white hover:bg-white/5 transition"
                    >
                        Projects
                    </button>
                    <button
                        onClick={signOut}
                        className="px-3.5 py-2 rounded-xl border border-white/10 text-xs uppercase tracking-widest text-white/60 hover:text-white hover:bg-white/5 transition"
                    >
                        Logout
                    </button>
                </div>
            </header>

            {showTopicIdeasPanel && (
                <div className="fixed inset-0 z-50 overflow-y-auto">
                    <div className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setShowTopicIdeasPanel(false)}></div>
                    <div className="min-h-full flex items-start justify-center px-4 py-6 sm:py-10">
                        <div className="relative w-full max-w-6xl max-h-[92vh] overflow-hidden rounded-[24px] sm:rounded-[32px] border border-white/10 bg-[#05070F] text-white shadow-2xl flex flex-col">
                            <div className="flex items-center justify-between px-4 sm:px-6 py-4 border-b border-white/10">
                                <div>
                                    <p className="text-[10px] sm:text-xs uppercase tracking-[0.4em] text-white/50">Viral Topic Finder</p>
                                    <h3 className="text-xl sm:text-2xl font-black">Ideas tailored to your persona</h3>
                                </div>
                                <button
                                    onClick={() => setShowTopicIdeasPanel(false)}
                                    className="text-white/60 hover:text-white transition text-xl"
                                >
                                    ✕
                                </button>
                            </div>
                            <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-6 space-y-6">
                                {isFindingTopics && !topicIdeas.length ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-center space-y-4">
                                        <span className="w-12 h-12 border-2 border-white/20 border-t-white rounded-full animate-spin" />
                                        <p className="text-sm uppercase tracking-[0.4em] text-white/40">Scanning trend radar...</p>
                                    </div>
                                ) : (
                                    <>
                                        {topicFinderResult && (
                                            <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
                                                <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-2">
                                                    <p className="text-[10px] uppercase tracking-[0.4em] text-white/40">Persona Snapshot</p>
                                                    <p className="text-lg font-semibold">{topicFinderResult.personaSummary.personaLabel}</p>
                                                    <p className="text-sm text-white/70">{topicFinderResult.personaSummary.tone}</p>
                                                    <p className="text-xs text-white/50">Audience: {topicFinderResult.personaSummary.audience}</p>
                                                    <div className="flex flex-wrap gap-1">
                                                        {topicFinderResult.personaSummary.painPoints.map(point => (
                                                            <span key={point} className="px-2 py-1 text-[10px] bg-white/10 rounded-full">{point}</span>
                                                        ))}
                                                    </div>
                                                </div>
                                                <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-2">
                                                    <p className="text-[10px] uppercase tracking-[0.4em] text-white/40">Freshness Radar</p>
                                                    <ul className="text-sm text-white/80 list-disc list-inside space-y-1">
                                                        {(topicFinderResult.freshnessRadar && topicFinderResult.freshnessRadar.length ? topicFinderResult.freshnessRadar : ['No live radar data']).map(item => (
                                                            <li key={item}>{item}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                                <div className="p-4 rounded-2xl border border-white/10 bg-white/5 space-y-2">
                                                    <p className="text-[10px] uppercase tracking-[0.4em] text-white/40">Global Hashtags</p>
                                                    <div className="flex flex-wrap gap-2">
                                                        {(topicFinderResult.globalHashtags || []).map(tag => (
                                                            <span key={tag} className="px-3 py-1 text-xs bg-black/40 border border-white/10 rounded-full">{tag}</span>
                                                        ))}
                                                    </div>
                                                    <p className="text-[10px] uppercase tracking-[0.4em] text-white/40 pt-2">Trend Insights</p>
                                                    <ul className="text-sm text-white/80 list-disc list-inside space-y-1">
                                                        {(topicFinderResult.trendInsights || []).map(insight => (
                                                            <li key={insight}>{insight}</li>
                                                        ))}
                                                    </ul>
                                                </div>
                                            </div>
                                        )}

                                        <div className="space-y-4">
                                            {topicIdeas.length === 0 && (
                                                <div className="text-center text-white/60 text-sm py-8">
                                                    No topic ideas yet. Try adjusting the persona or link and scout again.
                                                </div>
                                            )}
                                            {topicIdeas.map(idea => {
                                                const isEditing = editingIdeaId === idea.id;
                                                const isRemixing = regeneratingIdeaId === idea.id;
                                                return (
                                                    <div key={idea.id} className="p-5 rounded-3xl border border-white/10 bg-gradient-to-br from-white/5 to-transparent space-y-3">
                                                        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
                                                            <div>
                                                                <p className="text-xs uppercase tracking-[0.4em] text-white/40">Idea</p>
                                                                <h4 className="text-xl font-bold">{idea.title}</h4>
                                                            </div>
                                                            <div className="flex flex-wrap gap-2 text-xs text-white/60">
                                                                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">{idea.angle}</span>
                                                                <span className="px-3 py-1 rounded-full bg-white/10 border border-white/10">{idea.trendReason}</span>
                                                            </div>
                                                        </div>
                                                        {isEditing ? (
                                                            <textarea
                                                                className="w-full bg-black/40 border border-white/10 rounded-2xl px-4 py-3 text-sm"
                                                                value={editingIdeaText}
                                                                onChange={e => setEditingIdeaText(e.target.value)}
                                                                rows={3}
                                                            />
                                                        ) : (
                                                            <p className="text-white/80 text-sm leading-relaxed">
                                                                {idea.rawTopicLine || idea.hook || 'No hook generated yet.'}
                                                            </p>
                                                        )}
                                                        <div className="flex flex-wrap gap-2 text-xs text-white/70">
                                                            {idea.hashtagStack.map(tag => (
                                                                <span key={tag} className="px-3 py-1 rounded-full bg-black/40 border border-white/10">{tag}</span>
                                                            ))}
                                                        </div>
                                                        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm text-white/70">
                                                            <div>
                                                                <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Reference Creators</p>
                                                                <p>{idea.referenceCreators.join(', ') || '—'}</p>
                                                            </div>
                                                            <div>
                                                                <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Call to action</p>
                                                                <p>{idea.callToAction}</p>
                                                            </div>
                                                        </div>
                                                        <div className="flex flex-wrap gap-3 pt-2">
                                                            {isEditing ? (
                                                                <>
                                                                    <button
                                                                        onClick={handleSaveIdeaEdit}
                                                                        className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-black"
                                                                    >
                                                                        Save edit
                                                                    </button>
                                                                    <button
                                                                        onClick={handleCancelIdeaEdit}
                                                                        className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/10 text-white/70"
                                                                    >
                                                                        Cancel
                                                                    </button>
                                                                </>
                                                            ) : (
                                                                <button
                                                                    onClick={() => handleStartIdeaEdit(idea)}
                                                                    className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/10 text-white/80 hover:bg-white/20"
                                                                >
                                                                    Edit idea
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={() => handleUseIdea(idea)}
                                                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-white text-black"
                                                            >
                                                                Use topic
                                                            </button>
                                                            <button
                                                                onClick={() => handleUseIdea(idea, { autoPlan: true })}
                                                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-insta-mid/80 text-white hover:bg-insta-mid"
                                                            >
                                                                Use & build plan
                                                            </button>
                                                            <button
                                                                onClick={() => handleRemixIdea(idea)}
                                                                className="px-4 py-2 rounded-xl text-sm font-semibold bg-white/10 text-white/80 hover:bg-white/20"
                                                                disabled={isRemixing}
                                                            >
                                                                {isRemixing ? 'Remixing...' : 'Remix idea'}
                                                            </button>
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="px-6 py-4 border-t border-white/10 flex items-center justify-between text-xs text-white/50">
                                <span>Need a different direction? Adjust persona inputs and scout again.</span>
                                <button
                                    onClick={() => handleFindViralTopics()}
                                    className="text-white hover:text-white/80"
                                    disabled={isFindingTopics}
                                >
                                    {isFindingTopics ? 'Scanning...' : 'Refresh ideas'}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Usage Stats Modal */}
            {showUsageStats && <UsageStats onClose={() => setShowUsageStats(false)} />}

            {/* Projects Panel (History Only) */}
            {showProjects && session?.user && (
                <ProjectsPanel
                    history={history}
                    onClose={() => setShowProjects(false)}
                    onLoadHistory={handleReopenPlan}
                    onRefreshHistory={refreshHistory}
                />
            )}

            {notice && (
                <div className={`fixed top-20 left-1/2 -translate-x-1/2 z-[999] w-[90%] max-w-xl rounded-2xl border backdrop-blur px-4 py-3 flex items-center justify-between text-sm ${
                    notice.type === 'error' ? 'bg-red-500/15 border-red-500/40 text-red-200'
                    : notice.type === 'warning' ? 'bg-amber-500/15 border-amber-500/40 text-amber-200'
                    : 'bg-white/10 border-white/30 text-white'
                }`}>
                    <span className="text-left pr-4">{notice.message}</span>
                    <button onClick={() => setNotice(null)} className="text-xs uppercase tracking-widest hover:opacity-80">Dismiss</button>
                </div>
            )}

            {step === AppStep.LANDING && (
                <section className="relative flex items-center justify-center py-24 px-6 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#0F172A] via-[#0B1121] to-[#05070F]"></div>
                    <div className="absolute inset-y-10 inset-x-0 mx-auto w-[90%] max-w-5xl blur-[120px] rounded-full bg-gradient-to-r from-insta-start/40 via-insta-mid/20 to-insta-purple/30"></div>
                    <div className="absolute -left-24 top-20 w-72 h-72 rounded-full bg-insta-mid/10 blur-3xl animate-pulse"></div>
                    <div className="absolute -right-32 bottom-10 w-80 h-80 rounded-full bg-purple-900/30 blur-3xl animate-pulse [animation-delay:1s]"></div>

                    <div className="relative z-10 w-full max-w-6xl grid grid-cols-1 lg:grid-cols-2 gap-16">
                        <div className="space-y-8 text-center lg:text-left">
                            <div className="inline-flex items-center gap-2 px-4 py-1 rounded-full bg-white/10 text-xs uppercase tracking-[0.3em] text-white/70 border border-white/20">
                                <span>AI Reel Studio</span>
                                <span className="text-insta-mid">Live</span>
                            </div>
                            <div className="space-y-4">
                                <p className="text-sm font-mono text-white/60">From prompt → storyboard → soundtrack</p>
                                <h1 className="text-5xl lg:text-6xl font-black leading-none">
                                    Launch <span className="bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple text-transparent bg-clip-text">viral videos</span> in minutes.
                                </h1>
                                <p className="text-lg text-white/70">
                                    ReelAI orchestrates trend research, scripts, assets, voiceovers, and music so you can ship cinematic social content without a production crew.
                                </p>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full max-w-lg">
                                <button
                                    onClick={() => handleStartWorkflow(CreationMode.MEDIA_UPLOAD)}
                                    className={heroCtaButtonClass}
                                >
                                    <span className="text-xl">📹</span>
                                    <div className="text-left">
                                        <div className="font-bold">Upload Media</div>
                                        <div className="text-[10px] text-white/50 font-normal">Start from your own clips</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleStartWorkflow(CreationMode.TEXT_TO_REEL)}
                                    className={heroCtaButtonClass}
                                >
                                    <span className="text-xl">✨</span>
                                    <div className="text-left">
                                        <div className="font-bold">Text to Reel</div>
                                        <div className="text-[10px] text-white/50 font-normal">AI generates everything</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => handleStartWorkflow(CreationMode.EDIT_EXISTING)}
                                    className={heroCtaButtonClass}
                                >
                                    <span className="text-xl">✂️</span>
                                    <div className="text-left">
                                        <div className="font-bold">Edit Existing</div>
                                        <div className="text-[10px] text-white/50 font-normal">Refine your projects</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        setCreationMode(CreationMode.SONG_TO_VIDEO);
                                        setStep(AppStep.SONG_UPLOAD);
                                    }}
                                    className="relative px-8 py-4 rounded-2xl border border-insta-purple/50 text-white font-semibold flex items-center justify-center gap-3 bg-gradient-to-br from-insta-purple/20 to-insta-mid/10 hover:from-insta-purple/30 hover:to-insta-mid/20 transition group overflow-hidden"
                                >
                                    <div className="absolute top-0 right-0 bg-insta-purple text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">NEW</div>
                                    <span className="text-xl group-hover:scale-110 transition">🎵</span>
                                    <div className="text-left">
                                        <div className="font-bold">Song to Video</div>
                                        <div className="text-[10px] text-white/60 font-normal">Visuals synced to beat</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => {
                                        setCreationMode(CreationMode.BRAND_VIDEO);
                                        setStep(AppStep.BRAND_HUB);
                                    }}
                                    className="relative px-8 py-4 rounded-2xl border border-purple-500/50 text-white font-semibold flex items-center justify-center gap-3 bg-gradient-to-br from-purple-600/20 to-pink-500/10 hover:from-purple-600/30 hover:to-pink-500/20 transition group overflow-hidden col-span-full sm:col-span-1"
                                >
                                    <div className="absolute top-0 right-0 bg-gradient-to-r from-purple-600 to-pink-500 text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">NEW</div>
                                    <span className="text-xl group-hover:scale-110 transition">🏢</span>
                                    <div className="text-left">
                                        <div className="font-bold">Brand Ad Agency</div>
                                        <div className="text-[10px] text-white/60 font-normal">Curate brand, product & concept</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => { setCreationMode(CreationMode.AGENT_HUB); setStep(AppStep.UPLOAD); }}
                                    className="relative px-8 py-4 rounded-2xl border border-emerald-500/50 text-white font-semibold flex items-center justify-center gap-3 bg-gradient-to-br from-emerald-600/20 to-cyan-500/10 hover:from-emerald-600/30 hover:to-cyan-500/20 transition group overflow-hidden col-span-full sm:col-span-1"
                                >
                                    <div className="absolute top-0 right-0 bg-gradient-to-r from-emerald-600 to-cyan-500 text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">NEW</div>
                                    <span className="text-xl group-hover:scale-110 transition">✦</span>
                                    <div className="text-left">
                                        <div className="font-bold">Agent Hub</div>
                                        <div className="text-[10px] text-white/60 font-normal">Autonomous ads with human review gates</div>
                                    </div>
                                </button>
                                <button
                                    onClick={() => { setCreationMode(CreationMode.IMAGE_STUDIO); setStep(AppStep.UPLOAD); }}
                                    className="relative px-8 py-4 rounded-2xl border border-pink-500/50 text-white font-semibold flex items-center justify-center gap-3 bg-gradient-to-br from-pink-600/20 to-violet-500/10 hover:from-pink-600/30 hover:to-violet-500/20 transition group overflow-hidden col-span-full sm:col-span-1"
                                >
                                    <div className="absolute top-0 right-0 bg-gradient-to-r from-pink-600 to-violet-500 text-[9px] font-bold px-2 py-0.5 rounded-bl-lg">NEW</div>
                                    <span className="text-xl group-hover:scale-110 transition">🎨</span>
                                    <div className="text-left">
                                        <div className="font-bold">Image Studio</div>
                                        <div className="text-[10px] text-white/60 font-normal">AI-powered image creation & editing</div>
                                    </div>
                                </button>
                            </div>
                            <div className="flex flex-col sm:flex-row gap-4 text-white/70 text-sm">
                                <div className="flex-1 p-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                                    <p className="text-3xl font-black text-white">+4.7M</p>
                                    <p className="uppercase tracking-widest text-[10px] text-white/60">Views generated this week</p>
                                </div>
                                <div className="flex-1 p-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur">
                                    <p className="text-3xl font-black text-white">87%</p>
                                    <p className="uppercase tracking-widest text-[10px] text-white/60">Faster production cycles</p>
                                </div>
                            </div>
                            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                                <div className="p-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur text-left">
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-2">Latest Reels</p>
                                    {history.slice(0, 3).length === 0 && <p className="text-xs text-white/50">No activity yet.</p>}
                                    {history.slice(0, 3).map(entry => (
                                        <div key={entry.id} className="mb-2 last:mb-0">
                                            <p className="text-sm text-white font-semibold">{entry.metadata?.plan?.topic || entry.topic || 'Untitled'}</p>
                                            <p className="text-[11px] text-white/40">{new Date(entry.created_at).toLocaleDateString()} · {entry.status}</p>
                                        </div>
                                    ))}
                                </div>
                                <div className="p-4 rounded-2xl border border-white/10 bg-white/5 backdrop-blur text-left">
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-2">Quick Actions</p>
                                    <button
                                        onClick={() => setShowProjects(true)}
                                        className="w-full text-left text-xs text-white/60 hover:text-white transition py-1"
                                    >
                                        📂 Open Projects
                                    </button>
                                    <button
                                        onClick={() => setStep(AppStep.GENERATING_ASSETS)}
                                        className="w-full text-left text-xs text-white/60 hover:text-white transition py-1"
                                    >
                                        ✨ New Reel
                                    </button>
                                    <button
                                        onClick={() => setStep(AppStep.VIDEO_EDITOR)}
                                        className="w-full text-left text-xs text-white/60 hover:text-white transition py-1"
                                    >
                                        🎬 Video Editor
                                    </button>
                                </div>
                            </div>
                        </div>

                        <div className="relative">
                            <div className="absolute inset-0 bg-gradient-to-r from-white/10 via-white/5 to-transparent rounded-[40px] blur-2xl"></div>
                            <div className="relative rounded-[40px] border border-white/10 bg-white/5 backdrop-blur-2xl p-8 shadow-[0_40px_120px_-60px_rgba(0,0,0,0.9)] space-y-6">
                                <div className="flex items-center justify-between text-xs text-white/60 uppercase">
                                    <span>Workflow Snapshot</span>
                                    <span>LIVE</span>
                                </div>
                                <div className="space-y-4">
                                    {["Trend radar", "Script lab", "Visual forge"].map((label, idx) => (
                                        <div key={label} className="p-4 rounded-2xl border border-white/10 bg-black/30 flex items-center justify-between">
                                            <div>
                                                <p className="text-sm uppercase tracking-[0.2em] text-white/40">Phase 0{idx + 1}</p>
                                                <p className="text-lg font-semibold text-white">{label}</p>
                                            </div>
                                            <div className="text-2xl">{idx === 0 ? '📈' : idx === 1 ? '📝' : '🎨'}</div>
                                        </div>
                                    ))}
                                </div>
                                <div className="rounded-2xl border border-white/10 bg-black/40 p-6 space-y-3">
                                    <p className="text-xs uppercase tracking-[0.4em] text-white/40">Realtime Builder</p>
                                    <p className="text-xl font-semibold">Hook: "No one told you skincare serums need THIS combo"</p>
                                    <p className="text-sm text-white/70">Auto-generating script, visuals, captions and soundtrack in one sweep.</p>
                                    <div className="flex gap-2">
                                        <span className="text-[10px] bg-white/10 px-3 py-1 rounded-full uppercase tracking-widest">Viral Mode</span>
                                        <span className="text-[10px] bg-insta-mid/30 px-3 py-1 rounded-full uppercase tracking-widest">Gen-Z</span>
                                    </div>
                                </div>
                            </div>
                            <div className="absolute -bottom-8 -left-6 px-4 py-3 rounded-2xl bg-white text-black text-sm font-semibold shadow-lg rotate-[-4deg]">
                                ⚡ Trend pulse synced
                            </div>
                            <div className="absolute -top-6 -right-4 px-4 py-3 rounded-2xl bg-black/70 border border-white/10 text-white text-sm font-semibold shadow-lg rotate-3">
                                🎧 Music cue ready
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {creationMode === CreationMode.AGENT_HUB && step !== AppStep.LANDING && (
                <AgentHub
                    onBack={() => { setCreationMode(null); setStep(AppStep.LANDING); }}
                    onLaunchAgent={(agentId, params) => {
                        try {
                            const leanLaunch = prepareHubAgentLaunchForSessionStorage(
                              params as Record<string, unknown>,
                              agentId,
                            );
                            stashPendingHubLaunch(leanLaunch);
                        } catch (error) {
                            console.error('[AgentHub] Launch failed to persist', error);
                            window.alert('Could not launch agent with those attachments. Try smaller files.');
                            return;
                        }
                        setHubConsoleAgentId(agentId || 'ad-agent');
                        setCreationMode(CreationMode.AGENT_CONSOLE);
                    }}
                />
            )}

            {creationMode === CreationMode.AGENT_CONSOLE && (
                hubConsoleAgentId === 'general-agent'
                  ? (
                    <GeneralAgentConsole
                        userId={session?.user?.id || 'anonymous'}
                        onBack={() => { setCreationMode(null); setStep(AppStep.LANDING); }}
                    />
                  )
                  : (
                    <AgentConsole
                        userId={session?.user?.id || 'anonymous'}
                        onBack={() => { setCreationMode(null); setStep(AppStep.LANDING); }}
                    />
                  )
            )}

            {creationMode === CreationMode.IMAGE_STUDIO && (
                <div className="flex flex-col h-[calc(100vh-4rem)]">
                    <div className="flex items-center gap-2 px-4 py-2 border-b border-dark-border">
                        <button
                            onClick={() => { setCreationMode(null); setStep(AppStep.LANDING); }}
                            className="px-3 py-1.5 rounded-lg text-sm text-gray-300 hover:text-white hover:bg-white/10 transition-colors"
                        >
                            ← Back
                        </button>
                        <span className="text-sm text-gray-400">Image Studio</span>
                    </div>
                    <div className="flex-1 overflow-hidden">
                        <AIImageStudioScreen />
                    </div>
                </div>
            )}

            {creationMode === CreationMode.BRAND_VIDEO && step !== AppStep.LANDING && (
                <BrandVideoCreator
                    userId={session?.user?.id || 'anonymous'}
                    onBack={() => {
                        setCreationMode(null);
                        setStep(AppStep.LANDING);
                    }}
                    onConceptApproved={(blueprint: CampaignBlueprint, brand) => {
                        const agentHandoff = mapCampaignBlueprintToAgentLaunch(blueprint, brand);

                        // Carousel/static: slides stay on Concept Review — no Agent Console navigation.
                        if (!agentHandoff.isVideoAd) {
                            const studioHandoff = mapCampaignBlueprintToStudioHandoff(blueprint, brand);
                            setBrandKit(prev => ({
                                ...prev,
                                ...Object.fromEntries(
                                    Object.entries(studioHandoff.brandKitPatch).filter(([, value]) => value !== undefined),
                                ),
                                productImages: studioHandoff.productImages.length ? studioHandoff.productImages : prev.productImages,
                                assetCatalog: studioHandoff.assetCatalog.length ? studioHandoff.assetCatalog : prev.assetCatalog,
                            }));
                            setBrandAssetCatalog(studioHandoff.assetCatalog);
                            return;
                        }

                        if (!agentHandoff.params.productUrl) {
                            window.alert('Add a product URL in Brand Ad Agency before producing with Ad Agent. Agency curation cannot hand off without a product page.');
                            return;
                        }

                        try {
                            const leanLaunch = prepareAgentLaunchForSessionStorage(agentHandoff);
                            stashPendingHubLaunch(leanLaunch);
                        } catch (error) {
                            console.error('[BrandVideo] Agency→Agent handoff failed to persist', error);
                            window.alert('Could not hand off to Ad Agent. Try again with fewer locked product images.');
                            return;
                        }
                        setHubConsoleAgentId('ad-agent');
                        setCreationMode(CreationMode.AGENT_CONSOLE);
                    }}
                />
            )}

            {creationMode === CreationMode.SONG_TO_VIDEO && step !== AppStep.LANDING && step !== AppStep.VIDEO_EXTENSION && step !== AppStep.PREVIEW && step !== AppStep.EXPORT && (
                <SongToVideoStudio
                    onBack={() => {
                        setCreationMode(null);
                        setStep(AppStep.LANDING);
                    }}
                    onComplete={(mediaItems, state) => {
                        const normalizedMedia = normalizeMediaIdentity(mediaItems);
                        setMedia(normalizedMedia);
                        setSceneDrafts(createSceneDraftsFromMediaAndScript(normalizedMedia, null));
                        setSlideDurations(normalizedMedia.map(deriveClipDuration));
                        setSongToVideoState(state);
                        setStep(AppStep.VIDEO_EXTENSION);
                        logReelHistory('assets_generated', {
                            metadata: {
                                songToVideoState: state,
                                mediaCount: normalizedMedia.length
                            },
                            modeOverride: CreationMode.SONG_TO_VIDEO
                        });
                    }}
                    initialState={songToVideoState}
                />
            )}

            {step === AppStep.TOPIC_INPUT && (() => {
                const isCustomDuration = !isPresetDurationValue(targetDuration) && targetDuration !== 0;
                const topicAdvancedSetCount = [
                    Boolean(topicPersona.trim()),
                    Boolean(topicCreatorUrl.trim()),
                    referenceLinks.length > 0,
                    topicIdeaCount !== 6,
                    !ecoMode,
                    selectedStyle !== ScriptStyle.Professional,
                    Boolean(musicVibeDescription.trim()),
                ].filter(Boolean).length;
                const brandKitSetCount = [
                    Boolean(brandKit.hexColor && brandKit.hexColor.toLowerCase() !== '#ffffff'),
                    Boolean(brandKit.websiteUrl?.trim()),
                    Boolean(brandKit.logo),
                    Boolean(brandKit.productImages?.length),
                ].filter(Boolean).length;

                return (
                <section className="relative min-h-[calc(100vh-64px)] py-16 sm:py-20 px-6 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#05070F] via-[#0A101C] to-[#111827]"></div>
                    <div className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,_rgba(255,255,255,0.06),_transparent_55%)]"></div>
                    <div className="absolute -bottom-32 left-1/2 -translate-x-1/2 w-[42rem] h-72 bg-sky-900/20 blur-[140px] rounded-full"></div>

                    <div className="relative z-10 max-w-[760px] mx-auto space-y-10">
                        <div className="space-y-4 text-center sm:text-left">
                            <p className="text-4xl sm:text-5xl font-black tracking-tight text-white">ReelAI</p>
                            <h2 className="text-3xl sm:text-4xl font-semibold leading-tight text-white/95">What's the idea?</h2>
                            <p className="text-white/65 text-base sm:text-lg max-w-xl">
                                Drop a working title, vibe, or hook. We'll scout trends and build the reel around your duration.
                            </p>
                        </div>

                        <div className="space-y-5">
                            <div className="space-y-3">
                                <label className="sr-only" htmlFor="topic-idea-input">Idea</label>
                                <textarea
                                    id="topic-idea-input"
                                    rows={3}
                                    className="w-full bg-black/35 border border-white/12 rounded-2xl px-5 py-4 text-lg text-white placeholder:text-white/35 focus:border-white/35 outline-none resize-none"
                                    placeholder="e.g. Skincare tips that actually work"
                                    value={textToReelTopic}
                                    onChange={e => setTextToReelTopic(e.target.value)}
                                />

                                <div className="space-y-2">
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Duration</p>
                                    <div className="flex flex-wrap gap-2">
                                        {DURATION_PRESETS.map((preset) => (
                                            <button
                                                key={preset.value}
                                                type="button"
                                                onClick={() => {
                                                    setTargetDuration(preset.value);
                                                    setCustomDurationInput('');
                                                }}
                                                className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition border ${
                                                    !isCustomDuration && targetDuration === preset.value
                                                        ? 'bg-white text-black border-white'
                                                        : 'bg-black/30 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
                                                }`}
                                            >
                                                {preset.label}
                                            </button>
                                        ))}
                                        <button
                                            type="button"
                                            onClick={() => {
                                                const fallback = isCustomDuration
                                                    ? targetDuration
                                                    : MIN_CUSTOM_DURATION;
                                                setTargetDuration(Math.min(MAX_CUSTOM_DURATION, Math.max(MIN_CUSTOM_DURATION, fallback)));
                                                setCustomDurationInput(String(
                                                    isCustomDuration ? targetDuration : MIN_CUSTOM_DURATION,
                                                ));
                                            }}
                                            className={`px-3.5 py-2 rounded-xl text-sm font-semibold transition border ${
                                                isCustomDuration
                                                    ? 'bg-white text-black border-white'
                                                    : 'bg-black/30 text-white/70 border-white/10 hover:bg-white/10 hover:text-white'
                                            }`}
                                        >
                                            Custom
                                        </button>
                                    </div>
                                    {isCustomDuration && (
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="number"
                                                min={MIN_CUSTOM_DURATION}
                                                max={MAX_CUSTOM_DURATION}
                                                value={customDurationInput || String(targetDuration)}
                                                onChange={(e) => {
                                                    const value = e.target.value;
                                                    setCustomDurationInput(value);
                                                    if (value.trim() === '') return;
                                                    const numeric = Number(value);
                                                    if (!Number.isFinite(numeric)) return;
                                                    setTargetDuration(Math.min(MAX_CUSTOM_DURATION, Math.max(MIN_CUSTOM_DURATION, numeric)));
                                                }}
                                                className="w-24 bg-black/40 border border-white/12 rounded-xl px-3 py-2 text-sm text-white"
                                                placeholder="30"
                                            />
                                            <span className="text-sm text-white/50">seconds</span>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="flex flex-col items-stretch sm:items-start gap-3">
                                <button
                                    type="button"
                                    onClick={() => handleFindViralTopics()}
                                    disabled={isFindingTopics || !textToReelTopic.trim()}
                                    className={`w-full sm:w-auto px-8 py-3.5 rounded-2xl text-base font-semibold transition ${
                                        isFindingTopics || !textToReelTopic.trim()
                                            ? 'bg-white/20 text-white/50 cursor-not-allowed'
                                            : 'bg-white text-black hover:-translate-y-0.5'
                                    }`}
                                >
                                    {isFindingTopics ? (
                                        <span className="inline-flex items-center gap-2">
                                            <span className="animate-spin inline-block w-4 h-4 border-2 border-black/40 border-t-black rounded-full" />
                                            Scouting...
                                        </span>
                                    ) : (
                                        'Scout Viral Topics'
                                    )}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => handleGeneratePlan()}
                                    disabled={!textToReelTopic.trim() || isFindingTopics}
                                    className="text-sm text-white/70 underline underline-offset-4 hover:text-white disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed self-center sm:self-start"
                                >
                                    Skip scout — generate plan
                                </button>
                                {topicIdeas.length > 0 && (
                                    <button
                                        type="button"
                                        onClick={() => setShowTopicIdeasPanel(true)}
                                        className="text-sm text-white/80 underline underline-offset-4 hover:text-white self-center sm:self-start"
                                    >
                                        View {topicIdeas.length} suggestions
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="space-y-3 pt-2">
                            <div className="flex flex-wrap gap-2">
                                <button
                                    type="button"
                                    onClick={() => setShowTopicAdvanced((prev) => !prev)}
                                    className="px-4 py-2 rounded-xl text-sm border border-white/12 bg-black/25 text-white/80 hover:bg-white/5 transition"
                                >
                                    More options{topicAdvancedSetCount > 0 ? ` · ${topicAdvancedSetCount} set` : ''}
                                    <span className="ml-2 text-white/40">{showTopicAdvanced ? 'Hide' : 'Show'}</span>
                                </button>
                                <button
                                    type="button"
                                    onClick={() => setShowBrandKitPanel((prev) => !prev)}
                                    className="px-4 py-2 rounded-xl text-sm border border-white/12 bg-black/25 text-white/80 hover:bg-white/5 transition"
                                >
                                    Brand kit{brandKitSetCount > 0 ? ` · ${brandKitSetCount} set` : ' · optional'}
                                    <span className="ml-2 text-white/40">{showBrandKitPanel ? 'Hide' : 'Show'}</span>
                                </button>
                            </div>

                            {showTopicAdvanced && (
                                <div className="border border-white/10 bg-black/30 rounded-2xl p-5 space-y-4">
                                    <div className="space-y-2">
                                        <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Text model</p>
                                        <p className="text-[11px] text-white/45">
                                          Default GLM 5.3 Flash (z.ai Coding Plan). Images stay on Gemini Flash Image. Fallback is always Gemini.
                                        </p>
                                        <PlannerModelControls
                                          value={textModel}
                                          onChange={setTextModel}
                                          variant="chips"
                                        />
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Persona / Channel vibe</label>
                                            <input
                                                className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm placeholder:text-white/40 focus:border-white/30 outline-none"
                                                placeholder="e.g. Gen-Z dermatologist on TikTok"
                                                value={topicPersona}
                                                onChange={e => setTopicPersona(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Creator profile link</label>
                                            <input
                                                type="url"
                                                className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm placeholder:text-white/40 focus:border-white/30 outline-none"
                                                placeholder="https://instagram.com/yourhandle"
                                                value={topicCreatorUrl}
                                                onChange={e => setTopicCreatorUrl(e.target.value)}
                                            />
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Scout suggestions</label>
                                            <div className="bg-black/30 border border-white/10 rounded-xl p-2 flex flex-wrap gap-2">
                                                {[5, 6, 8, 10].map(count => (
                                                    <button
                                                        key={count}
                                                        type="button"
                                                        onClick={() => setTopicIdeaCount(count)}
                                                        className={`flex-1 px-2 py-1 rounded-lg text-xs font-semibold transition ${topicIdeaCount === count ? 'bg-white text-black' : 'bg-white/10 text-white/60 hover:bg-white/20'}`}
                                                    >
                                                        {count}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Generation Mode</label>
                                            <button
                                                type="button"
                                                onClick={() => setEcoMode(!ecoMode)}
                                                className={`h-full border rounded-xl px-4 py-2 flex items-center justify-between transition ${ecoMode ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300' : 'bg-black/30 border-white/10 text-white/60 hover:bg-white/5'}`}
                                            >
                                                <div className="flex flex-col items-start">
                                                    <span className="text-xs font-semibold">{ecoMode ? 'Eco Mode' : 'Deep QA Mode'}</span>
                                                    <span className="text-[10px] opacity-70">{ecoMode ? 'Faster & cheaper drafts' : 'Thorough dual-pass analysis'}</span>
                                                </div>
                                                <div className={`w-10 h-5 rounded-full relative transition-colors ${ecoMode ? 'bg-emerald-500/30' : 'bg-white/10'}`}>
                                                    <div className={`absolute top-1 w-3 h-3 rounded-full bg-current transition-transform ${ecoMode ? 'left-6' : 'left-1'}`} />
                                                </div>
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Reference drops (comma or newline)</label>
                                        <textarea
                                            className="bg-black/30 border border-white/10 rounded-xl px-4 py-3 text-sm placeholder:text-white/40 focus:border-white/30 outline-none min-h-[72px]"
                                            placeholder="Paste IG posts, competitor articles, campaign decks..."
                                            value={topicReferenceInput}
                                            onChange={e => setTopicReferenceInput(e.target.value)}
                                        />
                                        {referenceLinks.length > 0 && (
                                            <div className="flex flex-wrap gap-2 text-[11px] text-white/70">
                                                {referenceLinks.slice(0, 6).map(link => (
                                                    <span key={link} className="px-3 py-1 rounded-full bg-white/10 border border-white/10">
                                                        {formatReferenceLabel(link)}
                                                    </span>
                                                ))}
                                                {referenceLinks.length > 6 && (
                                                    <span className="px-3 py-1 rounded-full bg-white/5 border border-white/10">+{referenceLinks.length - 6} more</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Script Style</label>
                                            <select
                                                value={selectedStyle}
                                                onChange={e => setSelectedStyle(e.target.value as ScriptStyle)}
                                                className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm text-white outline-none focus:border-white/30 cursor-pointer"
                                            >
                                                {Object.values(ScriptStyle).map(style => (
                                                    <option key={style} value={style} className="bg-gray-900">{style}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div className="flex flex-col gap-2">
                                            <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Music Vibe (optional)</label>
                                            <input
                                                className="bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm placeholder:text-white/40 focus:border-white/30 outline-none"
                                                placeholder="e.g. upbeat lo-fi, dramatic orchestral..."
                                                value={musicVibeDescription}
                                                onChange={e => setMusicVibeDescription(e.target.value)}
                                            />
                                        </div>
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        <label className="text-[10px] uppercase tracking-[0.3em] text-white/40">Try a sample</label>
                                        <div className="flex flex-wrap gap-2 text-xs text-white/70">
                                            {['Shop launch teaser', 'Before/after skincare routine', 'AI tools for creators', 'Holiday gifting script'].map(sample => (
                                                <button
                                                    key={sample}
                                                    type="button"
                                                    onClick={() => setTextToReelTopic(sample)}
                                                    className="px-3 py-1 rounded-full bg-white/5 border border-white/10 hover:bg-white/10 transition"
                                                >
                                                    {sample}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            )}

                            {showBrandKitPanel && (
                                <div className="border border-white/10 bg-black/30 rounded-2xl p-5 space-y-5">
                                    <div className="flex items-center justify-between text-xs uppercase tracking-[0.3em] text-white/40">
                                        <span>Brand Kit</span>
                                        <span>Optional</span>
                                    </div>
                                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                                        <div>
                                            <label className="text-[10px] uppercase text-white/50">Accent Color</label>
                                            <div className="mt-2 h-14 rounded-xl border border-white/10 bg-black/30 flex items-center justify-center">
                                                <input
                                                    type="color"
                                                    className="w-3/4 h-10 bg-transparent border border-white/10 rounded-lg cursor-pointer"
                                                    value={brandKit.hexColor || '#ffffff'}
                                                    onChange={e => setBrandKit({ ...brandKit, hexColor: e.target.value })}
                                                />
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] uppercase text-white/50">Website or handle</label>
                                            <input
                                                type="text"
                                                className="mt-2 w-full h-14 bg-black/30 border border-white/10 rounded-xl px-4 text-sm"
                                                placeholder="mysite.com"
                                                value={brandKit.websiteUrl || ''}
                                                onChange={e => setBrandKit({ ...brandKit, websiteUrl: e.target.value })}
                                            />
                                        </div>
                                    </div>
                                    <div className="grid grid-cols-2 gap-4">
                                        <label className="h-32 border border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2 text-sm text-white/60 cursor-pointer hover:bg-white/5 transition">
                                            {brandKit.logo ? (
                                                <img src={brandKit.logo.previewUrl} className="w-20 h-20 object-contain" alt="Brand logo" />
                                            ) : (
                                                <span>Upload logo</span>
                                            )}
                                            <input type="file" hidden accept="image/*" onChange={handleLogoUpload} />
                                        </label>
                                        <label className="h-32 border border-dashed border-white/20 rounded-2xl flex flex-col items-center justify-center gap-2 text-sm text-white/60 cursor-pointer hover:bg-white/5 transition">
                                            <span>Add product shots</span>
                                            <input type="file" hidden accept="image/*" multiple onChange={handleProductUpload} />
                                        </label>
                                    </div>
                                    {brandKit.productImages && brandKit.productImages.length > 0 && (
                                        <div>
                                            <p className="text-[10px] uppercase text-white/40 mb-2">Mood references</p>
                                            <div className="grid grid-cols-3 gap-3">
                                                {brandKit.productImages.map((img, i) => (
                                                    <div key={i} className="h-20 rounded-xl overflow-hidden border border-white/10">
                                                        <img src={img.previewUrl} className="w-full h-full object-cover" alt={`Product ${i + 1}`} />
                                                    </div>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                    <p className="text-xs text-white/55">
                                        We'll harmonize captions, palette, and motion with your brand kit. Skip it for stock-style visuals.
                                    </p>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
                );
            })()}

            {step === AppStep.GENERATING_ASSETS && (
                <section className="relative min-h-[calc(100vh-64px)] w-full flex flex-col items-center justify-center px-6 py-16 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-black/30 via-[#050712] to-[#03040A]"></div>
                    <div className="absolute -top-28 right-10 w-72 h-72 bg-insta-purple/25 blur-[140px] rounded-full"></div>
                    <div className="absolute -bottom-16 left-0 w-60 h-60 bg-insta-start/20 blur-[120px] rounded-full"></div>

                    <div className="relative z-10 w-full max-w-4xl space-y-10 text-center animate-fade-in">
                        <div className="space-y-4">
                            <div className="relative w-24 h-24 mx-auto">
                                <div className="absolute inset-0 rounded-full border border-white/15"></div>
                                <div className="absolute inset-2 rounded-full border-2 border-transparent bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple animate-spin-slow"></div>
                                <div className="absolute inset-4 rounded-full bg-black/70 flex items-center justify-center">
                                    <span className="text-sm font-mono text-insta-mid">{visualStep}/{milestoneCount}</span>
                                </div>
                                <div className="absolute -top-2 left-1/2 -translate-x-1/2 w-3 h-3 rounded-full bg-white animate-pulse" />
                            </div>
                            <p className="text-xs uppercase tracking-[0.3em] text-white/50">Intel Sweep {Math.round(generationProgress)}%</p>
                            <h2 className="text-3xl sm:text-4xl font-black text-white">{generationStatusText || currentMilestone.title}</h2>
                            <p className="text-sm text-white/60 italic">{generationQuips[generationQuipIndex]}</p>
                        </div>

                        <div className="grid gap-6 lg:grid-cols-2 text-left">
                            <div className="bg-white/5 backdrop-blur-2xl border border-white/10 rounded-[32px] p-6 space-y-5 shadow-[0_30px_90px_-60px_rgba(0,0,0,1)]">
                                <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.4em] text-white/40">
                                    <span>Current focus</span>
                                    <span>Next</span>
                                </div>
                                <div className="flex items-center justify-between">
                                    <p className="text-xl font-semibold text-white">{currentMilestone.title}</p>
                                    <p className="text-sm text-white/70">{nextMilestone?.title || 'Final Assembly'}</p>
                                </div>
                                <div className="h-2 bg-white/5 rounded-full overflow-hidden">
                                    <div className="h-full bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple transition-all duration-500" style={{ width: `${generationProgress}% ` }} />
                                </div>
                                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                                    {(() => {
                                        const start = Math.max(0, visualStep - 2);
                                        const slice = milestoneMeta.slice(start, Math.min(milestoneCount, start + 3));
                                        return slice.map((milestone, idx) => {
                                            const originalIdx = start + idx;
                                            const status = originalIdx + 1 < visualStep ? 'done' : originalIdx + 1 === visualStep ? 'active' : 'todo';
                                            return (
                                                <div key={milestone.title} className={`rounded-2xl border px-3 py-3 space-y-1 ${status === 'active'
                                                    ? 'border-insta-purple/60 bg-insta-purple/15'
                                                    : status === 'done'
                                                        ? 'border-emerald-400/60 bg-emerald-400/10'
                                                        : 'border-white/10 bg-black/40 text-white/60'
                                                    } `}>
                                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/40">Phase {originalIdx + 1}</p>
                                                    <p className="text-sm font-semibold text-white">{milestone.title}</p>
                                                    {status === 'active' && <p className="text-[11px] text-insta-mid">Decrypting context…</p>}
                                                </div>
                                            );
                                        });
                                    })()}
                                </div>
                            </div>

                            <div className="bg-black/50 border border-white/10 rounded-[32px] p-6 space-y-4 backdrop-blur-2xl shadow-[0_30px_90px_-60px_rgba(0,0,0,1)]">
                                <div className="flex items-center justify-between">
                                    <p className="text-sm font-semibold text-white">Insight Ping</p>
                                    <span className="text-[10px] uppercase tracking-[0.4em] text-white/40">Live</span>
                                </div>
                                <p className="text-base text-white/80">{generationStatusText || currentMilestone.subtitle}</p>
                                <div className="grid grid-cols-2 gap-3 text-sm text-white/60">
                                    <div className="p-3 rounded-2xl border border-white/10 bg-white/5">
                                        <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1">Assets</p>
                                        <p className="text-lg font-semibold text-white">{generatedImagesCount}/{reelPlan?.scenes.length || media.length || 1}</p>
                                    </div>
                                    <div className="p-3 rounded-2xl border border-white/10 bg-white/5">
                                        <p className="text-[10px] uppercase tracking-[0.3em] text-white/40 mb-1">Status</p>
                                        <p className="text-lg font-semibold text-white/80">{generationQuips[generationQuipIndex]}</p>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {step === AppStep.REVIEW_PLAN && reelPlan && (
                <section className="relative py-10 px-4 sm:px-8 overflow-hidden min-h-[calc(100vh-64px)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#05070F] via-[#0B1121] to-[#11061C]"></div>
                    <div className="absolute inset-y-10 inset-x-0 mx-auto max-w-6xl blur-[120px] rounded-full bg-gradient-to-r from-emerald-500/10 via-transparent to-insta-purple/20"></div>

                    <div className="relative z-10 max-w-5xl mx-auto space-y-8">
                        <div className="flex items-center justify-between">
                            <div>
                                <p className="text-xs uppercase tracking-[0.4em] text-white/40 mb-2">Review & Edit Plan</p>
                                <h2 className="text-3xl font-black">Your Reel Blueprint</h2>
                                <p className="text-white/60 mt-1">Review each scene before we generate images. Edit prompts to fine-tune visuals.</p>
                            </div>
                            <div className="flex gap-3">
                                {!hasProductBackedPlan && (
                                    <div className="flex gap-2 items-center">
                                        <input
                                            type="text"
                                            placeholder="What to change? e.g. 'More funny'"
                                            value={regenFeedback}
                                            onChange={e => setRegenFeedback(e.target.value)}
                                            onKeyDown={e => e.key === 'Enter' && handleRegeneratePlan()}
                                            className="bg-black/40 border border-white/20 rounded-xl px-3 py-2 text-sm text-white placeholder:text-white/30 outline-none focus:border-insta-mid w-52"
                                        />
                                        <button
                                            onClick={handleRegeneratePlan}
                                            disabled={!regenFeedback.trim()}
                                            className="px-4 py-2 rounded-xl border border-white/20 text-white/80 hover:bg-white/5 transition text-sm font-semibold disabled:opacity-40"
                                        >
                                            Regenerate
                                        </button>
                                    </div>
                                )}
                                <button
                                    onClick={() => setStep(AppStep.TOPIC_INPUT)}
                                    className="px-4 py-2 rounded-xl border border-white/10 text-white/60 hover:text-white transition text-sm"
                                >
                                    Back
                                </button>
                            </div>
                        </div>

                        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Topic</p>
                                <p className="text-lg font-semibold">{reelPlan.topic}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Vibe</p>
                                <p className="text-lg font-semibold">{reelPlan.vibe}</p>
                            </div>
                            <div className="bg-white/5 border border-white/10 rounded-2xl p-4">
                                <p className="text-[10px] uppercase tracking-widest text-white/40 mb-1">Scenes</p>
                                <p className="text-lg font-semibold">{reelPlan.scenes.length} shots</p>
                            </div>
                        </div>

                        {reelPlan.strategicReasoning && (
                            <div className="bg-gradient-to-r from-insta-start/10 to-insta-purple/10 border border-insta-mid/20 rounded-2xl p-4">
                                <p className="text-[10px] uppercase tracking-widest text-insta-mid mb-2">Strategic Reasoning</p>
                                <p className="text-sm text-white/80">{reelPlan.strategicReasoning}</p>
                            </div>
                        )}

                        <div className="space-y-4 max-h-[50vh] overflow-y-auto custom-scrollbar pr-2">
                            {reelPlan.scenes.map((scene, idx) => (
                                <div key={idx} className="bg-black/40 border border-white/10 rounded-2xl p-5 space-y-4 group">
                                    <div className="flex items-center justify-between">
                                        <div className="flex items-center gap-3">
                                            <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-insta-start to-insta-purple flex items-center justify-center font-bold text-sm">
                                                {scene.sceneNumber}
                                            </div>
                                            <div>
                                                <p className="text-sm font-semibold">Scene {scene.sceneNumber}</p>
                                                <p className="text-[11px] text-white/50">
                                                    {scene.estimatedDuration}s duration |
                                                    {' '}
                                                    {scene.userProvidedImage ? '$0.00 (provided image)' : '$0.03 AI cost'}
                                                </p>
                                            </div>
                                        </div>
                                        <button
                                            onClick={() => handleDeleteSceneFromPlan(idx)}
                                            className="opacity-0 group-hover:opacity-100 px-3 py-1.5 text-xs text-red-400 hover:text-red-300 hover:bg-red-500/10 rounded-lg border border-red-500/20 transition-all"
                                            title="Delete scene to save costs"
                                        >
                                            Delete
                                        </button>
                                    </div>

                                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                                        <div className="space-y-2">
                                            <label className="text-[10px] uppercase tracking-widest text-white/40">Visual Description</label>
                                            <textarea
                                                className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm resize-none h-20 outline-none focus:border-insta-mid"
                                                value={scene.visualDescription}
                                                onChange={e => handleUpdateScene(idx, 'visualDescription', e.target.value)}
                                            />
                                        </div>
                                        <div className="space-y-2">
                                            <label className="text-[10px] uppercase tracking-widest text-white/40">Image Generation Prompt</label>
                                            <textarea
                                                className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm font-mono resize-none h-20 outline-none focus:border-insta-mid"
                                                value={scene.imagePrompt}
                                                onChange={e => handleUpdateScene(idx, 'imagePrompt', e.target.value)}
                                            />
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <label className="text-[10px] uppercase tracking-widest text-white/40">Script Guidance</label>
                                        <textarea
                                            className="w-full bg-black/30 border border-white/10 rounded-xl p-3 text-sm resize-none h-16 outline-none focus:border-insta-mid"
                                            value={scene.scriptGuidance}
                                            onChange={e => handleUpdateScene(idx, 'scriptGuidance', e.target.value)}
                                        />
                                    </div>

                                    <div className="rounded-2xl border border-dashed border-white/15 bg-black/30 p-4 flex flex-col lg:flex-row gap-4">
                                        <div className="flex-1">
                                            <p className="text-[10px] uppercase tracking-widest text-white/40">Provide Your Own Visual</p>
                                            <p className="text-xs text-white/60">Upload an image to skip AI generation and cost for this scene.</p>
                                            {scene.userProvidedImage ? (
                                                <p className="text-[11px] text-emerald-300 font-semibold mt-2">Custom image locked in. We'll skip AI cost here.</p>
                                            ) : (
                                                <p className="text-[11px] text-white/40 mt-2">Accepted: JPG, PNG, WEBP up to ~10MB.</p>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-3">
                                            {scene.userProvidedImage && (
                                                <div className="relative w-16 h-24 rounded-xl overflow-hidden border border-white/10 shadow-lg">
                                                    <img src={scene.userProvidedImage.previewUrl} className="w-full h-full object-cover" />
                                                    <button
                                                        onClick={() => handleRemovePlanSceneImage(idx)}
                                                        className="absolute top-1 right-1 bg-black/70 text-[10px] rounded-full px-1.5"
                                                        title="Remove custom image"
                                                    >
                                                        ✕
                                                    </button>
                                                </div>
                                            )}
                                            <label className="cursor-pointer px-4 py-2 rounded-xl border border-white/20 text-sm font-semibold bg-white/5 hover:bg-white/10 transition flex items-center gap-2">
                                                <span>{scene.userProvidedImage ? 'Replace Image' : 'Upload Image'}</span>
                                                <input type="file" accept="image/*" hidden onChange={e => handlePlanSceneImageInput(idx, e)} />
                                            </label>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>

                        {/* Add Scene Section */}
                        <div className="bg-white/5 border border-white/10 rounded-2xl p-4 space-y-3 mb-6">
                            <p className="text-xs uppercase tracking-widest text-white/40">Add New Scene</p>
                            <div className="flex gap-2">
                                <input
                                    type="text"
                                    placeholder="Describe the new scene (e.g. 'Close up of the final product')"
                                    className="flex-1 bg-black/30 border border-white/10 rounded-xl px-4 py-2 text-sm outline-none focus:border-insta-mid"
                                    value={addScenePrompt}
                                    onChange={e => setAddScenePrompt(e.target.value)}
                                    onKeyDown={e => e.key === 'Enter' && handleAddSceneToPlan()}
                                />
                                <button
                                    onClick={handleAddSceneToPlan}
                                    disabled={isAddingScene || !addScenePrompt.trim()}
                                    className="px-4 py-2 bg-white/10 hover:bg-white/20 rounded-xl text-sm font-semibold disabled:opacity-50"
                                >
                                    {isAddingScene ? 'Adding...' : 'Add +'}
                                </button>
                            </div>
                        </div>

                        <div className="bg-gradient-to-r from-amber-500/10 to-orange-500/10 border border-amber-500/20 rounded-2xl p-4 flex items-center justify-between">
                            <div>
                                <p className="text-[10px] uppercase tracking-widest text-amber-400 mb-1">Estimated Image Cost</p>
                                <p className="text-2xl font-bold text-white">${estimateImageCost(scenesRequiringAiCount)}</p>
                                <p className="text-xs text-white/50">{scenesRequiringAiCount} AI images x $0.03 each</p>
                                {providedScenesCount > 0 && (
                                    <p className="text-[11px] text-emerald-300">{providedScenesCount} provided image{providedScenesCount === 1 ? '' : 's'} (no cost)</p>
                                )}
                            </div>
                            <div className="text-right">
                                <p className="text-xs text-white/40 mb-1">Delete scenes to reduce cost</p>
                                <p className="text-[10px] text-white/30">Hover over scenes to see delete button</p>
                            </div>
                        </div>

                        <div className="flex justify-center pt-4">
                            <button
                                onClick={handleApproveAndGenerateImages}
                                className="px-10 py-4 rounded-2xl bg-gradient-to-r from-emerald-500 to-emerald-600 text-white font-bold text-lg shadow-[0_20px_60px_-20px_rgba(16,185,129,0.5)] hover:-translate-y-0.5 transition flex items-center gap-3"
                            >
                                <span>
                                    {scenesRequiringAiCount > 0
                                        ? `Approve & Generate ${scenesRequiringAiCount} AI Image${scenesRequiringAiCount === 1 ? '' : 's'} ($${estimateImageCost(scenesRequiringAiCount)})`
                                        : 'Approve Plan (all scenes provided)'}
                                </span>
                                <span className="text-xl">→</span>
                            </button>
                        </div>

                        <p className="text-center text-xs text-white/40">
                            Review your scenes above. Delete unnecessary ones or upload your own visuals to save on image generation costs.
                        </p>
                    </div>
                </section>
            )}

            {step === AppStep.UPLOAD && creationMode !== CreationMode.AGENT_CONSOLE && creationMode !== CreationMode.AGENT_HUB && creationMode !== CreationMode.IMAGE_STUDIO && (
                <section className="relative py-20 px-6 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#05070F] via-[#0A0F1F] to-[#090B14]"></div>
                    <div className="absolute inset-x-0 top-10 mx-auto w-[80%] max-w-4xl h-80 blur-[180px] rounded-full bg-gradient-to-r from-insta-start/20 via-insta-mid/10 to-insta-purple/20"></div>
                    <div className="relative z-10 max-w-6xl mx-auto grid grid-cols-1 xl:grid-cols-3 gap-10">
                        <div className="space-y-6 xl:col-span-1">
                            <div className="space-y-3">
                                <p className="text-xs uppercase tracking-[0.4em] text-white/40">Media Upload</p>
                                <h2 className="text-4xl font-black leading-tight">Drop in your assets.</h2>
                                <p className="text-white/70 text-base">Drag clips or photos—ReelAI auto-detects aspect ratios, durations, and creates thumbnails for your storyboard.</p>
                            </div>
                            {creationMode === CreationMode.EDIT_EXISTING && (
                                <div className="rounded-3xl border border-emerald-400/30 bg-emerald-500/10 p-5 space-y-3 text-sm text-white/70">
                                    <div className="flex items-center gap-2 text-emerald-300 font-semibold"><span>⚡</span><span>Edit Mode</span></div>
                                    <p>Skip research & script generation. Upload your finished reel, then jump straight into captions, voice, music, and export tools.</p>
                                    <button
                                        onClick={handleSkipToEditor}
                                        className="w-full py-3 rounded-2xl bg-emerald-400 text-black font-bold hover:-translate-y-0.5 transition"
                                    >
                                        Open Editor →
                                    </button>
                                </div>
                            )}
                            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 space-y-4">
                                {[{ title: 'Context Pulse', desc: 'Tell us why this footage matters.' }, { title: 'Auto-Tagging', desc: 'We tag shots for pacing & captions.' }, { title: 'Instant QA', desc: 'We flag low-light or shaky segments.' }].map((card, idx) => (
                                    <div key={card.title} className="flex gap-4">
                                        <div className="w-10 h-10 rounded-2xl bg-white/10 flex items-center justify-center font-bold text-sm">0{idx + 1}</div>
                                        <div>
                                            <p className="font-semibold">{card.title}</p>
                                            <p className="text-sm text-white/60">{card.desc}</p>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <div className="grid grid-cols-2 gap-4 text-white/70 text-sm">
                                <div className="p-4 rounded-2xl border border-white/10 bg-black/30">
                                    <p className="text-3xl font-black text-white">98%</p>
                                    <p className="text-[11px] uppercase tracking-widest text-white/50">Media readiness score</p>
                                </div>
                                <div className="p-4 rounded-2xl border border-white/10 bg-black/30">
                                    <p className="text-3xl font-black text-white">12</p>
                                    <p className="text-[11px] uppercase tracking-widest text-white/50">Clips supported/run</p>
                                </div>
                            </div>
                        </div>

                        <div className="xl:col-span-2 space-y-6">
                            <div className="rounded-[32px] border border-white/10 bg-white/5 backdrop-blur-xl p-8 shadow-[0_30px_100px_-70px_rgba(0,0,0,1)]">
                                <MediaInput
                                    media={media}
                                    onMediaUpload={(newMedia) => handleMediaUpload([...media, ...newMedia])}
                                    onRemove={(idx) => handleMediaUpload(media.filter((_, i) => i !== idx))}
                                    onClearAll={clearWorkspaceMedia}
                                />
                            </div>
                            <div className="rounded-[32px] border border-white/10 bg-black/40 backdrop-blur-xl p-8 space-y-4">
                                <label className="text-xs uppercase tracking-[0.3em] text-white/50">Context Notes</label>
                                <textarea
                                    className="w-full bg-black/30 border border-white/10 rounded-2xl px-4 py-3 min-h-[120px] text-white placeholder:text-white/30 focus:border-insta-mid outline-none"
                                    placeholder="What is the storyline, offer, or CTA for this footage?"
                                    value={userPrompt}
                                    onChange={e => setUserPrompt(e.target.value)}
                                />
                                <div className="flex flex-col sm:flex-row gap-4">
                                    <button
                                        onClick={handleInitialAnalysis}
                                        disabled={!media.length}
                                        className={`flex-1 py-4 rounded-2xl font-semibold ${media.length ? 'bg-white text-black hover:-translate-y-0.5' : 'bg-white/10 text-white/40 cursor-not-allowed'} transition`}
                                    >
                                        Analyze Uploads
                                    </button>
                                    {creationMode === CreationMode.EDIT_EXISTING && (
                                        <button
                                            onClick={handleSkipToEditor}
                                            className="flex-1 py-4 rounded-2xl border border-emerald-400/40 text-emerald-200 hover:bg-emerald-400/10 font-semibold"
                                            disabled={!media.length}
                                        >
                                            Skip to Editor
                                        </button>
                                    )}
                                    <button
                                        onClick={() => { setUserPrompt(''); clearWorkspaceMedia(); }}
                                        className="px-6 py-4 rounded-2xl border border-white/10 text-white/60 hover:text-white hover:border-white/40 transition"
                                    >
                                        Reset
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>
            )}

            {step === AppStep.ANALYZE_SCRIPT && (
                <ScriptStudio
                    initialScript={script}
                    initialSceneDrafts={sceneDrafts}
                    initialMedia={media}
                    onBack={() => setStep(
                        creationMode === CreationMode.TEXT_TO_REEL
                            ? AppStep.REVIEW_PLAN
                            : AppStep.UPLOAD,
                    )}
                    creationMode={creationMode}
                    hasProductBackedPlan={hasProductBackedPlan}
                    handleRegeneratePlan={handleRegeneratePlan}
                    scrollToAddSceneSection={scrollToAddSceneSection}
                    handleSmartAddScene={handleSmartAddScene}
                    reelPlanScenes={reelPlan?.scenes}
                    handleExecuteSceneRouteAction={handleExecuteSceneRouteAction}
                    handleSetSceneRouteOverride={handleSetSceneRouteOverride}
                    openSceneReferencePicker={openSceneReferencePicker}
                    handleSmartRewrite={handleSmartRewrite}
                    handleDeleteScene={handleDeleteScene}
                    invalidateGeneratedVoicePreview={invalidateGeneratedVoicePreview}
                    handleSceneImageInput={handleSceneImageInput}
                    handleSceneImageUpload={handleSceneImageUpload}
                    sceneImageInputRefs={sceneImageInputRefs}
                    addScenePanelRef={addScenePanelRef}
                    handleAddSceneToScript={handleAddSceneToScript}
                    onSyncSceneDrafts={(drafts) => setSceneDrafts(drafts)}
                    audioProgress={audioProgress}
                    targetDuration={resolveEffectiveTargetDuration(targetDuration) || undefined}
                    enableVoiceover={enableVoiceover}
                    setEnableVoiceover={setEnableVoiceover}
                    enableCaptions={enableCaptions}
                    setEnableCaptions={setEnableCaptions}
                    selectedVoiceId={selectedVoiceId}
                    setSelectedVoiceId={setSelectedVoiceId}
                    availableVoiceOptions={AVAILABLE_VOICE_OPTIONS}
                    voiceDetails={voiceDetails}
                    playingVoicePreview={playingVoicePreview}
                    handleVoicePreview={handleVoicePreview}
                    setShowVoiceRecorder={setShowVoiceRecorder}
                    musicPanelTab={musicPanelTab}
                    setMusicPanelTab={setMusicPanelTab}
                    customMusicPrompt={customMusicPrompt}
                    setCustomMusicPrompt={setCustomMusicPrompt}
                    handleGenerateMusic={handleGenerateMusic}
                    isGeneratingMusic={isGeneratingMusic}
                    handleMusicUpload={handleMusicUpload}
                    isAnalyzingMusic={isAnalyzingMusic}
                    uploadedMusicAnalysis={uploadedMusicAnalysis}
                    onNext={(finalScript, finalDrafts, finalMedia) => {
                        setScript(finalScript);
                        setSceneDrafts(finalDrafts);
                        setMedia(finalMedia);
                        handleGenerateAudio(finalScript, finalDrafts, finalMedia);
                    }}
                    isGeneratingAudio={isGeneratingAudio}
                />
            )}
            {sceneReferencePickerState && sceneReferencePickerContext.scene && (
                <SceneReferencePickerModal
                    open
                    mode={sceneReferencePickerState.mode}
                    sceneLabel={`Scene ${sceneReferencePickerContext.scene.sceneNumber}`}
                    productTitle={sceneReferencePickerContext.scene.productTitle}
                    candidates={sceneReferencePickerContext.candidates}
                    currentBindings={sceneReferencePickerContext.currentBindings}
                    currentBaseSelectionKey={sceneReferencePickerContext.currentBaseSelectionKey}
                    onClose={closeSceneReferencePicker}
                    onApplyBaseAsset={handleApplyBaseAssetSelection}
                    onSaveReferences={handleSaveSceneReferenceBindings}
                />
            )}
            {step === AppStep.VIDEO_EXTENSION && (script || creationMode === CreationMode.SONG_TO_VIDEO) && (
                <section className="relative py-12 px-6 overflow-hidden">
                    <div className="absolute inset-0 bg-gradient-to-b from-[#03040A] via-[#080C1A] to-[#120522]"></div>
                    <ErrorBoundary>
                        <VideoExtensionStudio
                            media={media}
                            script={script}
                            onBack={() => setStep(creationMode === CreationMode.SONG_TO_VIDEO ? AppStep.SONG_VIDEO_ASSEMBLY : AppStep.ANALYZE_SCRIPT)}
                        onUpdateMedia={handleStudioMediaUpdate}
                        onContinue={() => setStep(AppStep.PREVIEW)}
                        onExport={() => setStep(AppStep.EXPORT)}
                        onUpdateDuration={handleUpdateClipDuration}
                        onBulkUpdateDuration={handleBulkUpdateClipDuration}
                        onFitDurationsToTarget={handleFitDurationsToTarget}
                        onFitTimelineToMeasuredVoice={handleFitTimelineToMeasuredVoice}
                        onApplyRolePreset={handleApplyRolePreset}
                        onSetPacingRole={handleSetClipPacingRole}
                        onTogglePacingLock={handleToggleClipPacingLock}
                        onRippleDurationChange={handleRippleDurationChange}
                        onRegenerateVoice={script ? () => { void handleGenerateAudio(script, sceneDrafts, media); } : undefined}
                        isGeneratingAudio={isGeneratingAudio}
                        pacingScenes={pacingScenes}
                        targetDuration={resolveEffectiveTargetDuration(targetDuration) || undefined}
                        voiceStretchExtreme={pacingScenes.some(
                          (scene) => typeof scene.voiceSec === 'number' && scene.voiceSec > scene.slotSec + 0.05,
                        )}
                        initialSelectedIndex={videoStudioStartIndex}
                    />
                    </ErrorBoundary>
                </section>
            )}

            {step === AppStep.PREVIEW && (script || creationMode === CreationMode.SONG_TO_VIDEO) && (
                <section className="relative h-[calc(100vh-64px)]">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#03040A] via-[#080B18] to-[#12061E]"></div>
                    <div className="absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-white/5 via-transparent"></div>
                    <div className="relative z-10 h-full grid grid-cols-12">
                        <div className="col-span-12 md:col-span-3 bg-black/50 border-r border-white/5 p-4 flex flex-col gap-2 backdrop-blur-xl">
                            <h3 className="text-xs font-bold text-gray-500 uppercase mb-2">Tools</h3>
                            <button onClick={() => setStudioTab('visuals')} className={`p-3 rounded-xl text-left flex items-center gap-3 ${studioTab === 'visuals' ? 'bg-gradient-to-r from-insta-start to-insta-purple text-white shadow-lg' : 'hover:bg-white/5 text-gray-400'}`}><span>🎨</span> Color Grade</button>
                            <button onClick={() => setStudioTab('captions')} className={`p-3 rounded-xl text-left flex items-center gap-3 ${studioTab === 'captions' ? 'bg-gradient-to-r from-insta-start to-insta-purple text-white shadow-lg' : 'hover:bg-white/5 text-gray-400'}`}><span>📝</span> Typography</button>
                            <button onClick={() => setStudioTab('audio')} className={`p-3 rounded-xl text-left flex items-center gap-3 ${studioTab === 'audio' ? 'bg-gradient-to-r from-insta-start to-insta-purple text-white shadow-lg' : 'hover:bg-white/5 text-gray-400'}`}><span>🎚️</span> Audio Mix</button>
                            <button onClick={() => setStudioTab('effects')} className={`p-3 rounded-xl text-left flex items-center gap-3 ${studioTab === 'effects' ? 'bg-gradient-to-r from-insta-start to-insta-purple text-white shadow-lg' : 'hover:bg-white/5 text-gray-400'}`}><span>✨</span> Effects</button>
                            {(storyboardContinuitySummary.sceneCount > 0 || activePreviewScene) && (
                                <div className="mt-4 rounded-2xl border border-insta-mid/20 bg-gradient-to-r from-insta-start/10 via-white/5 to-insta-purple/10 p-4">
                                    <p className="text-[10px] uppercase tracking-[0.35em] text-insta-mid/80 mb-3">Approved Storyboard</p>
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/75">
                                            {storyboardContinuitySummary.productLanes.length || 1} product lane{(storyboardContinuitySummary.productLanes.length || 1) === 1 ? '' : 's'}
                                        </span>
                                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/75">
                                            {storyboardContinuitySummary.routeCount} route type{storyboardContinuitySummary.routeCount === 1 ? '' : 's'}
                                        </span>
                                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/75">
                                            {storyboardContinuitySummary.assetBackedCount} asset-backed
                                        </span>
                                    </div>
                                    {activePreviewScene && (
                                        <div className="rounded-xl border border-white/10 bg-black/30 p-3">
                                            <div className="flex items-center justify-between gap-2 mb-2">
                                                <p className="text-xs font-semibold text-white">Scene {activePreviewSceneIndex + 1}</p>
                                                {activePreviewRoute && (
                                                    <span className={`rounded-full border px-2 py-1 text-[10px] font-semibold ${getScriptStudioRouteTone(activePreviewRoute)}`}>
                                                        {getScriptStudioRouteLabel(activePreviewRoute)}
                                                    </span>
                                                )}
                                            </div>
                                            {activePreviewScene.productTitle && (
                                                <p className="text-[11px] text-cyan-100/80 mb-1">{activePreviewScene.productTitle}</p>
                                            )}
                                            {activePreviewScene.storyboardSourceMode && (
                                                <p className="text-[11px] text-white/55 mb-1">
                                                    Source: <span className="text-white/75">{getScriptStudioSourceModeLabel(activePreviewScene.storyboardSourceMode)}</span>
                                                </p>
                                            )}
                                            {activePreviewScene.storyboardLinkedAssetDescription && (
                                                <p className="text-[11px] text-white/55">
                                                    Variant: <span className="text-white/75">{activePreviewScene.storyboardLinkedAssetDescription}</span>
                                                </p>
                                            )}
                                            {!activePreviewScene.storyboardLinkedAssetDescription && activePreviewScene.storyboardBaseAssetDescription && (
                                                <p className="text-[11px] text-white/55">
                                                    Base asset: <span className="text-white/75">{activePreviewScene.storyboardBaseAssetDescription}</span>
                                                </p>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}
                            <div className="mt-auto space-y-2">
                                <button onClick={() => setStep(AppStep.VIDEO_EXTENSION)} className="w-full py-3 border border-white/10 rounded-xl text-sm hover:bg-white/5">🎬 Clip Studio</button>
                                {creationMode !== CreationMode.SONG_TO_VIDEO && (
                                    <button onClick={() => setStep(AppStep.ANALYZE_SCRIPT)} className="w-full py-3 border border-white/10 rounded-xl text-sm hover:bg-white/5">Back to Script</button>
                                )}
                                <button onClick={() => setStep(AppStep.EXPORT)} className="w-full py-3 bg-white/10 border border-white/20 rounded-xl text-sm text-white/80 hover:bg-white/20 flex items-center justify-center gap-2">🚀 Export Studio</button>
                            </div>
                        </div>

                        <div className="col-span-12 md:col-span-6 relative flex flex-col">
                            <div className="flex-1 bg-transparent flex items-center justify-center p-8 relative">
                                <div className="absolute inset-4 rounded-[40px] bg-gradient-to-br from-white/10 via-transparent to-white/5 blur-3xl"></div>
                                <div className="max-h-[85vh] w-auto aspect-[9/16] bg-black rounded-[50px] overflow-hidden shadow-2xl ring-8 ring-[#1a1a1a] relative border-[4px] border-[#333]">
                                    {/* Dynamic Island */}
                                    <div className="absolute top-5 left-1/2 -translate-x-1/2 w-[120px] h-[35px] bg-black rounded-full z-20 flex items-center justify-center gap-3">
                                        <div className="w-2 h-2 rounded-full bg-[#1a1a1a]/50"></div>
                                        <div className="w-16 h-full"></div>
                                    </div>

                                    {/* Home Indicator */}
                                    <div className="absolute bottom-2 left-1/2 -translate-x-1/2 w-32 h-1 bg-white/20 rounded-full z-20 pointer-events-none"></div>
                                    <ErrorBoundary>
                                        <ReelPreview
                                            media={media}
                                            script={script}
                                            audioBuffer={audioBuffer}
                                            audioPlaybackRate={voiceTimelinePlaybackRate}
                                            bgMusicBuffer={bgMusicBuffer}
                                            isPlaying={isPlaying}
                                            onPlayToggle={() => setIsPlaying(!isPlaying)}
                                            onRestart={() => setIsPlaying(false)}
                                            videoSpeed={videoSpeed}
                                            visualSettings={visualSettings}
                                            subtitleSettings={subtitleSettings}
                                            audioMixSettings={audioMix}
                                            slideDurations={slideDurations}
                                            audioSegmentDurations={audioSegmentDurations}
                                            enableCaptions={enableCaptions}
                                            exportPresets={availableExportPresets}
                                            autoExportPresetId={selectedExportPresetId}
                                            exportTriggerKey={exportTriggerKey}
                                            onVideoSpeedChange={setVideoSpeed}
                                            onSceneChange={setActivePreviewSceneIndex}
                                        />
                                    </ErrorBoundary>
                                </div>
                            </div>
                            <div className="h-32 bg-black/40 border-t border-white/5 p-4 flex gap-2 overflow-x-auto custom-scrollbar">
                                {/* Script Hook Preview */}
                                {script && script.hook && (
                                    <div className="aspect-[9/16] h-full rounded-xl bg-gradient-to-br from-insta-start/30 via-insta-mid/20 to-insta-purple/30 flex items-center justify-center p-3 border border-insta-mid/40 shrink-0">
                                        <div className="text-center flex flex-col items-center justify-center h-full">
                                            <div className="text-[8px] uppercase tracking-widest text-insta-mid font-bold mb-1">HOOK</div>
                                            <p className="text-[9px] font-bold text-white leading-tight line-clamp-6 px-1">{script.hook}</p>
                                        </div>
                                    </div>
                                )}
                                {/* Scene Thumbnails */}
                                {media.map((m, i) => (
                                    <div
                                        key={i}
                                        onClick={() => { setVideoStudioStartIndex(i); setStep(AppStep.VIDEO_EXTENSION); }}
                                        className="aspect-[9/16] h-full rounded-xl bg-gray-800 relative overflow-hidden opacity-70 hover:opacity-100 cursor-pointer border border-white/10 shrink-0 transition-opacity"
                                        title="Click to edit this scene"
                                    >
                                        <img src={getMediaDisplayUrl(m)} className="w-full h-full object-cover" />
                                        <span className="absolute bottom-1 left-1 text-[10px] bg-black/60 px-1 rounded">{i + 1}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        <div className="col-span-12 md:col-span-3 bg-black/40 border-l border-white/5 p-4 backdrop-blur-xl overflow-y-auto max-h-[calc(100vh-64px)]">
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="font-bold capitalize">{studioTab}</h3>
                                <span className="text-[10px] text-gray-500 uppercase tracking-wider">Inspector</span>
                            </div>

                            {studioTab === 'visuals' && (
                                <div className="space-y-5">
                                    {/* Filter Presets */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">Color Grade</label>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {['none', 'cinematic', 'vibrant', 'noir', 'warm', 'cool', 'vintage', 'moody'].map(f => (
                                                <button key={f} onClick={() => setVisualSettings({ ...visualSettings, filterPreset: f as FilterPreset })} className={`p-1.5 rounded text-[10px] border capitalize ${visualSettings.filterPreset === f ? 'border-insta-mid bg-insta-mid/20 text-white' : 'border-gray-700/50 text-gray-400'}`}>{f}</button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Color Adjustments */}
                                    <div className="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Adjustments</p>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Brightness</span><span>{Math.round(visualSettings.brightness * 100)}%</span></div>
                                            <input type="range" min="0.5" max="1.5" step="0.05" className="w-full accent-yellow-500 h-1" value={visualSettings.brightness} onChange={e => setVisualSettings({ ...visualSettings, brightness: parseFloat(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Contrast</span><span>{Math.round(visualSettings.contrast * 100)}%</span></div>
                                            <input type="range" min="0.5" max="1.5" step="0.05" className="w-full accent-orange-500 h-1" value={visualSettings.contrast} onChange={e => setVisualSettings({ ...visualSettings, contrast: parseFloat(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Saturation</span><span>{Math.round(visualSettings.saturation * 100)}%</span></div>
                                            <input type="range" min="0" max="2" step="0.1" className="w-full accent-pink-500 h-1" value={visualSettings.saturation} onChange={e => setVisualSettings({ ...visualSettings, saturation: parseFloat(e.target.value) })} />
                                        </div>
                                    </div>

                                    {/* Effects */}
                                    <div className="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Effects</p>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Vignette</span><span>{Math.round((visualSettings.vignette || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="1" step="0.1" className="w-full accent-purple-500 h-1" value={visualSettings.vignette || 0} onChange={e => setVisualSettings({ ...visualSettings, vignette: parseFloat(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Film Grain</span><span>{Math.round((visualSettings.grain || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="1" step="0.1" className="w-full accent-amber-500 h-1" value={visualSettings.grain || 0} onChange={e => setVisualSettings({ ...visualSettings, grain: parseFloat(e.target.value) })} />
                                        </div>
                                    </div>

                                    {/* Framing Mode */}
                                    <div className="space-y-2 p-3 bg-black/30 rounded-xl border border-white/5">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs font-semibold">Framing</p>
                                            <span className="text-[10px] text-gray-500">{visualSettings.framingMode === 'contain' ? 'Fit entire clip' : 'Fill frame'}</span>
                                        </div>
                                        <div className="grid grid-cols-2 gap-2 text-[11px]">
                                            <button
                                                onClick={() => setVisualSettings({ ...visualSettings, framingMode: 'cover' })}
                                                className={`p-2 rounded-lg border ${visualSettings.framingMode !== 'contain' ? 'border-insta-purple bg-insta-purple/20 text-white' : 'border-gray-700 text-gray-400'}`}
                                            >
                                                Crop to Fill
                                            </button>
                                            <button
                                                onClick={() => setVisualSettings({ ...visualSettings, framingMode: 'contain' })}
                                                className={`p-2 rounded-lg border ${visualSettings.framingMode === 'contain' ? 'border-insta-mid bg-insta-mid/20 text-white' : 'border-gray-700 text-gray-400'}`}
                                            >
                                                Fit with Bars
                                            </button>
                                        </div>
                                        <p className="text-[10px] text-gray-500">Choose whether we crop to vertical or letterbox unused space.</p>

                                        {visualSettings.framingMode !== 'contain' && (
                                            <div className="pt-3 border-t border-white/5">
                                                <div className="flex items-center justify-between text-[10px] text-gray-400 mb-1">
                                                    <span>Vertical Focus</span>
                                                    <span>{Math.round((visualSettings.framingFocusY ?? 0.5) * 100)}%</span>
                                                </div>
                                                <input
                                                    type="range"
                                                    min="0"
                                                    max="1"
                                                    step="0.01"
                                                    className="w-full accent-insta-purple"
                                                    value={visualSettings.framingFocusY ?? 0.5}
                                                    onChange={(e) => setVisualSettings({ ...visualSettings, framingFocusY: parseFloat(e.target.value) })}
                                                />
                                                <div className="flex justify-between text-[9px] text-gray-500 mt-1">
                                                    <span>Top</span>
                                                    <span>Center</span>
                                                    <span>Bottom</span>
                                                </div>
                                                <p className="text-[10px] text-gray-500 mt-1">Aim the crop up or down without stretching the frame.</p>
                                            </div>
                                        )}
                                    </div>

                                    {/* Motion */}
                                    <div className="flex items-center justify-between p-3 bg-black/30 rounded-xl border border-white/5">
                                        <div>
                                            <p className="text-xs font-semibold">Ken Burns Zoom</p>
                                            <p className="text-[10px] text-gray-500">Slow zoom on images</p>
                                        </div>
                                        <button onClick={() => setVisualSettings({ ...visualSettings, enableZoom: !visualSettings.enableZoom })} className={`w - 10 h - 6 rounded - full transition ${visualSettings.enableZoom ? 'bg-insta-mid' : 'bg-gray-700'} `}>
                                            <div className={`w - 4 h - 4 bg - white rounded - full transition - transform mx - 1 ${visualSettings.enableZoom ? 'translate-x-4' : ''} `}></div>
                                        </button>
                                    </div>
                                </div>
                            )}

                            {studioTab === 'captions' && (
                                <div className="space-y-4">
                                    {/* AI Auto-Suggest Button */}
                                    {script && (
                                        <div className="space-y-2">
                                            <button
                                                onClick={async () => {
                                                    setIsSuggestingCaptionStyle(true);
                                                    try {
                                                        const visualDescs = sceneDrafts?.map(d => d.visualDescription).filter(Boolean) || media.map(m => m.description).filter(Boolean);
                                                        const videoTopic = textToReelTopic || reelPlan?.topic || userPrompt || script?.title || '';
                                                        const suggestion = await suggestCaptionStyle(
                                                            script.fullText || script.hook,
                                                            selectedStyle,
                                                            {
                                                                brandColors: brandKit?.hexColor ? [brandKit.hexColor] : undefined,
                                                                videoTopic,
                                                                brandAesthetic: brandKit?.aestheticAnalysis || brandKit?.visualSignature,
                                                                visualDescriptions: visualDescs as string[],
                                                            }
                                                        );
                                                        setAiCaptionSuggestion(suggestion);
                                                        const calmMood = suggestion.mood === 'calm' || suggestion.mood === 'luxurious' || suggestion.mood === 'professional';
                                                        const elegantStyle = suggestion.style === 'cinematic' || suggestion.style === 'clean';
                                                        const suggestedSize = suggestion.fontSize
                                                            ?? (calmMood || elegantStyle ? 34 : 38);
                                                        setSubtitleSettings({
                                                            ...subtitleSettings,
                                                            style: suggestion.style as any,
                                                            animation: suggestion.animation as any,
                                                            fontFamily: suggestion.fontFamily,
                                                            displayMode: suggestion.displayMode,
                                                            fillColor: suggestion.colorScheme.fillColor,
                                                            outlineColor: suggestion.colorScheme.outlineColor,
                                                            highlightColor: suggestion.colorScheme.highlightColor,
                                                            glowColor: suggestion.colorScheme.glowColor,
                                                            gradientColors: suggestion.colorScheme.gradientColors,
                                                            fontSize: suggestedSize,
                                                            strokeWidth: suggestion.strokeWidth ?? (elegantStyle ? 2 : 8),
                                                            uppercase: suggestion.uppercase ?? !elegantStyle,
                                                            letterSpacing: elegantStyle ? 1 : 0,
                                                        });
                                                    } catch (e) {
                                                        console.error('AI suggestion failed', e);
                                                    } finally {
                                                        setIsSuggestingCaptionStyle(false);
                                                    }
                                                }}
                                                disabled={isSuggestingCaptionStyle}
                                                className="w-full p-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-600 text-white font-bold text-sm flex items-center justify-center gap-2 hover:from-purple-500 hover:to-pink-500 transition-all shadow-lg shadow-purple-500/25 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                {isSuggestingCaptionStyle ? (
                                                    <>
                                                        <span className="animate-spin">⏳</span> Analyzing...
                                                    </>
                                                ) : (
                                                    <>
                                                        <span>✨</span> AI Auto-Style
                                                        <span className="text-[10px] opacity-70">(analyzes your script)</span>
                                                    </>
                                                )}
                                            </button>
                                            {aiCaptionSuggestion && (
                                                <div className="p-2 bg-purple-500/10 border border-purple-500/30 rounded-lg">
                                                    <p className="text-[10px] text-purple-300 font-medium">{aiCaptionSuggestion.presetName}</p>
                                                    <p className="text-[9px] text-gray-400 mt-0.5">{aiCaptionSuggestion.reasoning}</p>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* Category Tabs */}
                                    <div>
                                        <div className="flex gap-1 mb-3 overflow-x-auto pb-1">
                                            {['viral', 'neon', 'gradient', 'minimal', 'cinematic', 'fun'].map(cat => (
                                                <button
                                                    key={cat}
                                                    onClick={() => {
                                                        const firstPreset = Object.values(CAPTION_PRESETS).find(p => p.category === cat);
                                                        if (firstPreset) setSubtitleSettings({ ...subtitleSettings, ...firstPreset.settings });
                                                    }}
                                                    className="px-3 py-1.5 rounded-full text-[10px] font-bold whitespace-nowrap border border-gray-700/50 text-gray-400 hover:border-insta-purple hover:text-white transition-all capitalize"
                                                >
                                                    {cat === 'viral' ? '🔥' : cat === 'neon' ? '💡' : cat === 'gradient' ? '🌈' : cat === 'minimal' ? '✨' : cat === 'cinematic' ? '🎬' : '🎉'} {cat}
                                                </button>
                                            ))}
                                        </div>

                                        {/* Preset Grid */}
                                        <div className="grid grid-cols-2 gap-2 max-h-[280px] overflow-y-auto pr-1">
                                            {Object.values(CAPTION_PRESETS).map((preset) => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => setSubtitleSettings({ ...subtitleSettings, ...preset.settings })}
                                                    className="group relative overflow-hidden rounded-xl border border-gray-700/50 hover:border-insta-purple transition-all hover:scale-[1.02] active:scale-[0.98] text-left"
                                                >
                                                    <div className="absolute inset-0 bg-gradient-to-br from-gray-800 to-gray-900 opacity-80"></div>
                                                    <div className="relative p-2.5">
                                                        <div className="h-7 flex items-center justify-center mb-1.5 bg-black/40 rounded-lg">
                                                            <span className="text-xs font-bold" style={preset.preview.style as React.CSSProperties}>{preset.preview.text}</span>
                                                        </div>
                                                        <p className="text-[10px] text-white font-semibold truncate">{preset.name}</p>
                                                        <p className="text-[8px] text-gray-500 truncate">{preset.description}</p>
                                                    </div>
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Display Mode Toggle */}
                                    <div className="p-3 bg-gradient-to-r from-gray-800/80 to-gray-900/80 rounded-xl border border-gray-700/50">
                                        <label className="text-[10px] font-bold text-gray-400 uppercase tracking-wider block mb-2">Display Mode</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setSubtitleSettings({ ...subtitleSettings, displayMode: 'sentence' })}
                                                className={`p-3 rounded-xl text-[11px] font-bold border-2 transition-all ${(subtitleSettings.displayMode || 'sentence') === 'sentence' ? 'border-insta-purple bg-insta-purple/20 text-white' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}
                                            >
                                                <span className="block text-lg mb-1">📝</span>
                                                Full Sentence
                                            </button>
                                            <button
                                                onClick={() => setSubtitleSettings({ ...subtitleSettings, displayMode: 'word-by-word' })}
                                                className={`p-3 rounded-xl text-[11px] font-bold border-2 transition-all ${subtitleSettings.displayMode === 'word-by-word' ? 'border-yellow-500 bg-yellow-500/20 text-yellow-300' : 'border-gray-700 text-gray-400 hover:border-gray-600'}`}
                                            >
                                                <span className="block text-lg mb-1">✨</span>
                                                Word-by-Word
                                            </button>
                                        </div>
                                    </div>

                                    {/* Style & Animation Row */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">Style</label>
                                            <select
                                                value={subtitleSettings.style}
                                                onChange={e => setSubtitleSettings({ ...subtitleSettings, style: e.target.value as any })}
                                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-[11px] text-white focus:border-insta-purple outline-none"
                                            >
                                                <option value="viral">🔥 Viral</option>
                                                <option value="clean">✨ Clean</option>
                                                <option value="box">⬛ Box</option>
                                                <option value="neon">💡 Neon</option>
                                                <option value="gradient">🌈 Gradient</option>
                                                <option value="karaoke">🎤 Karaoke</option>
                                                <option value="outline">⭕ Outline</option>
                                                <option value="cinematic">🎬 Cinematic</option>
                                            </select>
                                        </div>
                                        <div>
                                            <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">Animation</label>
                                            <select
                                                value={subtitleSettings.animation || 'none'}
                                                onChange={e => setSubtitleSettings({ ...subtitleSettings, animation: e.target.value as any })}
                                                className="w-full bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-[11px] text-white focus:border-insta-purple outline-none"
                                            >
                                                <option value="none">None</option>
                                                <option value="fade">Fade In</option>
                                                <option value="pop">Pop</option>
                                                <option value="bounce">Bounce</option>
                                                <option value="slide">Slide Up</option>
                                                <option value="zoom">Zoom</option>
                                                <option value="shimmer">✨ Shimmer</option>
                                                <option value="typewriter">⌨️ Typewriter</option>
                                                <option value="pulse">💓 Pulse</option>
                                                <option value="colorShift">🌈 Color Shift</option>
                                                <option value="shake">📳 Shake</option>
                                                <option value="wave">🌊 Wave</option>
                                            </select>
                                        </div>
                                    </div>

                                    {/* Font Selection - Premium Grid */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">Font</label>
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {FONT_OPTIONS.map(f => (
                                                <button
                                                    key={f.value}
                                                    onClick={() => setSubtitleSettings({ ...subtitleSettings, fontFamily: f.value })}
                                                    className={`p-2 text-[11px] border rounded-lg text-center transition-all ${subtitleSettings.fontFamily === f.value ? 'border-insta-purple bg-insta-purple/20 text-white scale-105' : 'border-gray-700/50 text-gray-400 hover:border-gray-600'}`}
                                                    style={{ fontFamily: f.value }}
                                                >
                                                    Aa
                                                </button>
                                            ))}
                                        </div>
                                        <p className="text-[9px] text-gray-500 mt-1.5 text-center">{subtitleSettings.fontFamily || 'Montserrat'}</p>
                                    </div>

                                    {/* Colors Section - Compact Premium */}
                                    <div className="space-y-3 p-3 bg-gray-800/50 rounded-xl border border-gray-700/50">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] font-bold text-gray-400 uppercase tracking-wider">Colors</p>
                                            {subtitleSettings.style === 'gradient' && (
                                                <span className="text-[8px] text-purple-400 bg-purple-500/20 px-2 py-0.5 rounded-full">Gradient Mode</span>
                                            )}
                                        </div>

                                        {/* Color Swatches Row */}
                                        <div className="flex items-center gap-2">
                                            <div className="flex-1">
                                                <label className="text-[8px] text-gray-500 block mb-1">Fill</label>
                                                <div className="flex items-center gap-1.5 bg-gray-900/50 rounded-lg p-1.5">
                                                    <input type="color" className="w-6 h-6 rounded cursor-pointer border-0" value={subtitleSettings.fillColor || '#FFFFFF'} onChange={e => setSubtitleSettings({ ...subtitleSettings, fillColor: e.target.value, color: e.target.value })} />
                                                    <span className="text-[9px] font-mono text-gray-400">{(subtitleSettings.fillColor || '#FFFFFF').toUpperCase()}</span>
                                                </div>
                                            </div>
                                            <div className="flex-1">
                                                <label className="text-[8px] text-gray-500 block mb-1">Outline</label>
                                                <div className="flex items-center gap-1.5 bg-gray-900/50 rounded-lg p-1.5">
                                                    <input type="color" className="w-6 h-6 rounded cursor-pointer border-0" value={subtitleSettings.outlineColor || '#000000'} onChange={e => setSubtitleSettings({ ...subtitleSettings, outlineColor: e.target.value })} />
                                                    <span className="text-[9px] font-mono text-gray-400">{(subtitleSettings.outlineColor || '#000000').toUpperCase()}</span>
                                                </div>
                                            </div>
                                        </div>

                                        {/* Conditional Colors */}
                                        {(subtitleSettings.displayMode === 'word-by-word' || subtitleSettings.style === 'neon' || subtitleSettings.style === 'gradient') && (
                                            <div className="flex items-center gap-2 pt-2 border-t border-gray-700/50">
                                                {subtitleSettings.displayMode === 'word-by-word' && (
                                                    <div className="flex-1">
                                                        <label className="text-[8px] text-yellow-400 block mb-1">✨ Highlight</label>
                                                        <div className="flex items-center gap-1.5 bg-yellow-500/10 rounded-lg p-1.5 border border-yellow-500/30">
                                                            <input type="color" className="w-6 h-6 rounded cursor-pointer border-0" value={subtitleSettings.highlightColor || '#FFFF00'} onChange={e => setSubtitleSettings({ ...subtitleSettings, highlightColor: e.target.value })} />
                                                            <span className="text-[9px] font-mono text-yellow-300">{(subtitleSettings.highlightColor || '#FFFF00').toUpperCase()}</span>
                                                        </div>
                                                    </div>
                                                )}
                                                {(subtitleSettings.style === 'neon' || subtitleSettings.style === 'karaoke') && (
                                                    <div className="flex-1">
                                                        <label className="text-[8px] text-cyan-400 block mb-1">💡 Glow</label>
                                                        <div className="flex items-center gap-1.5 bg-cyan-500/10 rounded-lg p-1.5 border border-cyan-500/30">
                                                            <input type="color" className="w-6 h-6 rounded cursor-pointer border-0" value={subtitleSettings.glowColor || '#00FFFF'} onChange={e => setSubtitleSettings({ ...subtitleSettings, glowColor: e.target.value })} />
                                                            <span className="text-[9px] font-mono text-cyan-300">{(subtitleSettings.glowColor || '#00FFFF').toUpperCase()}</span>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )}

                                        {/* Gradient Colors */}
                                        {subtitleSettings.style === 'gradient' && (
                                            <div className="pt-2 border-t border-gray-700/50">
                                                <label className="text-[8px] text-purple-400 block mb-1">🌈 Gradient Colors</label>
                                                <div className="flex items-center gap-2 bg-gradient-to-r from-purple-500/10 to-cyan-500/10 rounded-lg p-2 border border-purple-500/30">
                                                    <input type="color" className="w-8 h-8 rounded-lg cursor-pointer border-2 border-white/20" value={subtitleSettings.gradientColors?.[0] || '#FF00FF'} onChange={e => setSubtitleSettings({ ...subtitleSettings, gradientColors: [e.target.value, subtitleSettings.gradientColors?.[1] || '#00FFFF'] })} />
                                                    <div className="flex-1 h-4 rounded-full" style={{ background: `linear-gradient(90deg, ${subtitleSettings.gradientColors?.[0] || '#FF00FF'}, ${subtitleSettings.gradientColors?.[1] || '#00FFFF'})` }}></div>
                                                    <input type="color" className="w-8 h-8 rounded-lg cursor-pointer border-2 border-white/20" value={subtitleSettings.gradientColors?.[1] || '#00FFFF'} onChange={e => setSubtitleSettings({ ...subtitleSettings, gradientColors: [subtitleSettings.gradientColors?.[0] || '#FF00FF', e.target.value] })} />
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Size & Position */}
                                    <div className="grid grid-cols-2 gap-3">
                                        <div>
                                            <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Size</span><span>{subtitleSettings.fontSize}px</span></div>
                                            <input type="range" min="16" max="56" step="2" className="w-full accent-insta-purple h-1" value={subtitleSettings.fontSize} onChange={e => setSubtitleSettings({ ...subtitleSettings, fontSize: parseInt(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Position</span><span>{subtitleSettings.yPosition}%</span></div>
                                            <input type="range" min="10" max="90" step="5" className="w-full accent-insta-purple h-1" value={subtitleSettings.yPosition} onChange={e => setSubtitleSettings({ ...subtitleSettings, yPosition: parseInt(e.target.value) })} />
                                        </div>
                                    </div>

                                    {/* Background Shape */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">Background</label>
                                        <div className="grid grid-cols-5 gap-1">
                                            {[
                                                { id: 'none', label: 'None' },
                                                { id: 'box', label: 'Box' },
                                                { id: 'pill', label: 'Pill' },
                                                { id: 'bubble', label: 'Bubble' },
                                                { id: 'highlight', label: 'Marker' },
                                            ].map(bg => (
                                                <button
                                                    key={bg.id}
                                                    onClick={() => setSubtitleSettings({ ...subtitleSettings, backgroundShape: bg.id as any })}
                                                    className={`p-1.5 rounded text-[9px] border ${(subtitleSettings.backgroundShape || 'none') === bg.id ? 'border-insta-purple bg-insta-purple/20 text-white' : 'border-gray-700/50 text-gray-400'}`}
                                                >
                                                    {bg.label}
                                                </button>
                                            ))}
                                        </div>
                                        {subtitleSettings.backgroundShape && subtitleSettings.backgroundShape !== 'none' && (
                                            <div className="mt-2">
                                                <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Opacity</span><span>{Math.round((subtitleSettings.backgroundOpacity || 0.7) * 100)}%</span></div>
                                                <input type="range" min="0.1" max="1" step="0.1" className="w-full accent-gray-500 h-1" value={subtitleSettings.backgroundOpacity || 0.7} onChange={e => setSubtitleSettings({ ...subtitleSettings, backgroundOpacity: parseFloat(e.target.value) })} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Advanced Settings */}
                                    <div className="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Advanced</p>
                                        <div>
                                            <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Stroke Width</span><span>{subtitleSettings.strokeWidth || 6}px</span></div>
                                            <input type="range" min="0" max="12" step="1" className="w-full accent-gray-500 h-1" value={subtitleSettings.strokeWidth || 6} onChange={e => setSubtitleSettings({ ...subtitleSettings, strokeWidth: parseInt(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Letter Spacing</span><span>{subtitleSettings.letterSpacing || 0}px</span></div>
                                            <input type="range" min="0" max="10" step="1" className="w-full accent-gray-500 h-1" value={subtitleSettings.letterSpacing || 0} onChange={e => setSubtitleSettings({ ...subtitleSettings, letterSpacing: parseInt(e.target.value) })} />
                                        </div>
                                        {(subtitleSettings.style === 'neon' || subtitleSettings.glowColor) && (
                                            <div>
                                                <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Glow Intensity</span><span>{subtitleSettings.glowIntensity || 10}px</span></div>
                                                <input type="range" min="0" max="30" step="2" className="w-full accent-cyan-500 h-1" value={subtitleSettings.glowIntensity || 10} onChange={e => setSubtitleSettings({ ...subtitleSettings, glowIntensity: parseInt(e.target.value) })} />
                                            </div>
                                        )}
                                        {(subtitleSettings.animation === 'pop' || subtitleSettings.animation === 'bounce') && (
                                            <div>
                                                <div className="flex justify-between text-[9px] text-gray-400 mb-1"><span>Pop Scale</span><span>{subtitleSettings.popScale || 1.2}x</span></div>
                                                <input type="range" min="1" max="1.5" step="0.05" className="w-full accent-pink-500 h-1" value={subtitleSettings.popScale || 1.2} onChange={e => setSubtitleSettings({ ...subtitleSettings, popScale: parseFloat(e.target.value) })} />
                                            </div>
                                        )}
                                    </div>

                                    {/* Text Options */}
                                    <div className="flex gap-2">
                                        <button onClick={() => setSubtitleSettings({ ...subtitleSettings, uppercase: !subtitleSettings.uppercase })} className={`flex-1 p-2 rounded-lg text-[10px] font-bold border ${subtitleSettings.uppercase ? 'border-insta-purple bg-insta-purple/20 text-white' : 'border-gray-700 text-gray-400'}`}>
                                            UPPERCASE
                                        </button>
                                        <button onClick={() => setSubtitleSettings({ ...subtitleSettings, textAlign: subtitleSettings.textAlign === 'center' ? 'left' : subtitleSettings.textAlign === 'left' ? 'right' : 'center' })} className="flex-1 p-2 rounded-lg text-[10px] font-bold border border-gray-700 text-gray-400">
                                            Align: {subtitleSettings.textAlign || 'center'}
                                        </button>
                                    </div>
                                </div>
                            )}

                            {studioTab === 'audio' && (
                                <div className="space-y-5">
                                    <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Voice Timing</p>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={() => setAudioMix({ ...audioMix, voiceTimingMode: 'fit_timeline' })}
                                                className={`p-3 rounded-lg border text-left transition ${audioMix.voiceTimingMode !== 'natural' ? 'border-insta-mid bg-insta-mid/10 text-white' : 'border-gray-700 text-gray-400 hover:border-white/20'}`}
                                            >
                                                <p className="text-xs font-semibold">Fit Timeline</p>
                                                <p className="mt-1 text-[10px] text-inherit/70">Keeps narration synced after clip trims.</p>
                                            </button>
                                            <button
                                                onClick={() => setAudioMix({ ...audioMix, voiceTimingMode: 'natural' })}
                                                className={`p-3 rounded-lg border text-left transition ${audioMix.voiceTimingMode === 'natural' ? 'border-insta-mid bg-insta-mid/10 text-white' : 'border-gray-700 text-gray-400 hover:border-white/20'}`}
                                            >
                                                <p className="text-xs font-semibold">Natural Voice</p>
                                                <p className="mt-1 text-[10px] text-inherit/70">Preserves voice character even if visuals drift.</p>
                                            </button>
                                        </div>
                                    </div>

                                    {/* Volume Meters */}
                                    <div className="space-y-3">
                                        <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold flex items-center gap-2">🎙️ Voice</span>
                                                <span className="text-[10px] text-gray-400">{Math.round(audioMix.voiceVolume * 100)}%</span>
                                            </div>
                                            <input type="range" min="0" max="1.5" step="0.05" className="w-full accent-blue-500 h-2" value={audioMix.voiceVolume} onChange={e => setAudioMix({ ...audioMix, voiceVolume: parseFloat(e.target.value) })} />
                                            <div className="flex gap-1 mt-2">
                                                {[0, 0.5, 1, 1.5].map(v => (
                                                    <button key={v} onClick={() => setAudioMix({ ...audioMix, voiceVolume: v })} className={`flex-1 py-1 rounded text-[9px] ${Math.abs(audioMix.voiceVolume - v) < 0.1 ? 'bg-blue-500/30 text-blue-400' : 'bg-black/30 text-gray-500'}`}>{v === 0 ? 'Mute' : `${Math.round(v * 100)}%`}</button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold flex items-center gap-2">🎬 Clip / Original</span>
                                                <span className="text-[10px] text-gray-400">{Math.round((audioMix.clipVolume ?? 0) * 100)}%</span>
                                            </div>
                                            <p className="text-[10px] text-gray-500 mb-2">Soundtrack from uploaded or generated video clips.</p>
                                            <input type="range" min="0" max="1" step="0.05" className="w-full accent-orange-500 h-2" value={audioMix.clipVolume ?? 0} onChange={e => setAudioMix({ ...audioMix, clipVolume: parseFloat(e.target.value) })} />
                                            <div className="flex gap-1 mt-2">
                                                {[0, 0.35, 0.7, 1].map(v => (
                                                    <button key={v} onClick={() => setAudioMix({ ...audioMix, clipVolume: v })} className={`flex-1 py-1 rounded text-[9px] ${Math.abs((audioMix.clipVolume ?? 0) - v) < 0.05 ? 'bg-orange-500/30 text-orange-300' : 'bg-black/30 text-gray-500'}`}>{v === 0 ? 'Mute' : `${Math.round(v * 100)}%`}</button>
                                                ))}
                                            </div>
                                        </div>

                                        <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold flex items-center gap-2">🎵 Music</span>
                                                <span className="text-[10px] text-gray-400">{Math.round(audioMix.musicVolume * 100)}%</span>
                                            </div>
                                            <input type="range" min="0" max="1" step="0.05" className="w-full accent-green-500 h-2" value={audioMix.musicVolume} onChange={e => setAudioMix({ ...audioMix, musicVolume: parseFloat(e.target.value) })} />
                                            <div className="flex gap-1 mt-2">
                                                {[0, 0.15, 0.3, 0.5].map(v => (
                                                    <button key={v} onClick={() => setAudioMix({ ...audioMix, musicVolume: v })} className={`flex-1 py-1 rounded text-[9px] ${Math.abs(audioMix.musicVolume - v) < 0.05 ? 'bg-green-500/30 text-green-400' : 'bg-black/30 text-gray-500'}`}>{v === 0 ? 'Mute' : `${Math.round(v * 100)}%`}</button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Fade Controls */}
                                    <div className="space-y-3 p-3 bg-black/30 rounded-xl border border-white/5">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Fade</p>
                                        <div className="grid grid-cols-2 gap-3">
                                            <div>
                                                <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Fade In</span><span>{audioMix.fadeInDuration || 0}s</span></div>
                                                <input type="range" min="0" max="3" step="0.5" className="w-full accent-cyan-500 h-1" value={audioMix.fadeInDuration || 0} onChange={e => setAudioMix({ ...audioMix, fadeInDuration: parseFloat(e.target.value) })} />
                                            </div>
                                            <div>
                                                <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Fade Out</span><span>{audioMix.fadeOutDuration || 0}s</span></div>
                                                <input type="range" min="0" max="3" step="0.5" className="w-full accent-cyan-500 h-1" value={audioMix.fadeOutDuration || 0} onChange={e => setAudioMix({ ...audioMix, fadeOutDuration: parseFloat(e.target.value) })} />
                                            </div>
                                        </div>
                                    </div>

                                    {/* Ducking */}
                                    <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                                        <div className="flex items-center justify-between mb-2">
                                            <div>
                                                <p className="text-xs font-semibold">Auto Ducking</p>
                                                <p className="text-[10px] text-gray-500">Lower music &amp; clip audio when voice plays</p>
                                            </div>
                                            <button onClick={() => setAudioMix({ ...audioMix, enableDucking: !audioMix.enableDucking })} className={`w - 10 h - 6 rounded - full transition ${audioMix.enableDucking ? 'bg-green-500' : 'bg-gray-700'} `}>
                                                <div className={`w - 4 h - 4 bg - white rounded - full transition - transform mx - 1 ${audioMix.enableDucking ? 'translate-x-4' : ''} `}></div>
                                            </button>
                                        </div>
                                        {audioMix.enableDucking && (
                                            <div className="mt-3">
                                                <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Duck Amount</span><span>{Math.round((audioMix.duckingAmount || 0.5) * 100)}%</span></div>
                                                <input type="range" min="0.2" max="0.8" step="0.1" className="w-full accent-green-500 h-1" value={audioMix.duckingAmount || 0.5} onChange={e => setAudioMix({ ...audioMix, duckingAmount: parseFloat(e.target.value) })} />
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {studioTab === 'effects' && (
                                <div className="space-y-5">
                                    {/* Global Transitions */}
                                    <div>
                                        <label className="text-[10px] font-bold text-gray-500 uppercase tracking-wider block mb-2">Default Transition</label>
                                        <div className="grid grid-cols-2 gap-2">
                                            {['fade', 'slide', 'zoom', 'none'].map(t => (
                                                <button
                                                    key={t}
                                                    onClick={() => {
                                                        const transitionEffect = t as TransitionEffect;
                                                        setSceneDrafts(prev => prev.map((draft, index) => ({
                                                            ...draft,
                                                            media: {
                                                                ...(draft.media || media[index]),
                                                                id: draft.id,
                                                                sceneId: draft.id,
                                                                transitionEffect,
                                                            },
                                                        })));
                                                    }}
                                                    className="p-2 rounded-lg text-xs border border-gray-700 text-gray-400 hover:border-insta-purple hover:text-white capitalize"
                                                >
                                                    {t}
                                                </button>
                                            ))}
                                        </div>
                                    </div>

                                    {/* Speed Control */}
                                    <div className="p-3 bg-black/30 rounded-xl border border-white/5">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider mb-3">Visual Speed</p>
                                        <div className="flex flex-wrap gap-2">
                                            {[0.5, 0.75, 1, 1.2, 1.25, 1.4, 1.5, 2].map(s => (
                                                <button key={s} onClick={() => setVideoSpeed(s)} className={`px-3 py-2 rounded text-[10px] font-bold ${videoSpeed === s ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>{s}x</button>
                                            ))}
                                        </div>
                                        <div className="flex items-center gap-2 mt-3">
                                            <input
                                                type="number"
                                                min={0.25}
                                                max={4}
                                                step={0.05}
                                                value={videoSpeed}
                                                onChange={e => {
                                                    const v = parseFloat(e.target.value);
                                                    if (!isNaN(v) && v >= 0.25 && v <= 4) setVideoSpeed(v);
                                                }}
                                                className="w-20 bg-black/40 border border-white/10 rounded-lg px-2 py-1 text-xs text-white outline-none focus:border-insta-mid"
                                            />
                                            <span className="text-[10px] text-gray-500">Manual (0.25–4x)</span>
                                        </div>
                                    </div>

                                    {/* Motion Engine */}
                                    <div className="p-3 bg-black/30 rounded-xl border border-white/5 space-y-3">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Motion Engine</p>
                                        <div>
                                            <label className="text-[10px] text-gray-400 block mb-1.5">Camera Motion</label>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {(['random', 'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down', 'zoom-pan-tl', 'zoom-pan-br', 'zoom-pan-tr', 'zoom-pan-bl', 'breathing'] as const).map(d => (
                                                    <button key={d} onClick={() => setVisualSettings({ ...visualSettings, motionDirection: d, enableZoom: true })} className={`py-1.5 rounded text-[9px] font-bold ${visualSettings.motionDirection === d ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>
                                                        {d.replace(/-/g, ' ').replace('zoom pan', 'z+pan')}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Intensity</span><span>{Math.round((visualSettings.motionIntensity ?? 0.5) * 100)}%</span></div>
                                            <input type="range" min="0" max="1" step="0.1" className="w-full accent-insta-mid h-1" value={visualSettings.motionIntensity ?? 0.5} onChange={e => setVisualSettings({ ...visualSettings, motionIntensity: parseFloat(e.target.value) })} />
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button onClick={() => setVisualSettings({ ...visualSettings, enableParallax: !visualSettings.enableParallax })} className={`px-2.5 py-1 rounded text-[9px] font-bold ${visualSettings.enableParallax !== false ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>2.5D Parallax</button>
                                            <button onClick={() => setVisualSettings({ ...visualSettings, enableParticles: !visualSettings.enableParticles })} className={`px-2.5 py-1 rounded text-[9px] font-bold ${visualSettings.enableParticles !== false ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>Particles</button>
                                            <button onClick={() => setVisualSettings({ ...visualSettings, enableLightLeaks: !visualSettings.enableLightLeaks })} className={`px-2.5 py-1 rounded text-[9px] font-bold ${visualSettings.enableLightLeaks !== false ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>Light Leaks</button>
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Film Grain</span><span>{Math.round((visualSettings.grain || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="0.2" step="0.02" className="w-full accent-insta-mid h-1" value={visualSettings.grain || 0} onChange={e => setVisualSettings({ ...visualSettings, grain: parseFloat(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Vignette</span><span>{Math.round((visualSettings.vignette || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="0.6" step="0.05" className="w-full accent-insta-mid h-1" value={visualSettings.vignette || 0} onChange={e => setVisualSettings({ ...visualSettings, vignette: parseFloat(e.target.value) })} />
                                        </div>
                                    </div>

                                    {/* Viral Score Gauge */}
                                    <div className="p-3 bg-black/30 rounded-xl border border-white/5 space-y-2">
                                        <div className="flex items-center justify-between">
                                            <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Viral Score</p>
                                            <span className={`text-2xl font-black ${viralScore.total >= 75 ? 'text-green-400' : viralScore.total >= 50 ? 'text-yellow-400' : viralScore.total >= 25 ? 'text-orange-400' : 'text-red-400'}`}>{viralScore.total}</span>
                                        </div>
                                        <div className="flex gap-1 h-1.5">
                                            <div className="flex-1 bg-gray-700/50 rounded-full overflow-hidden"><div className="h-full bg-insta-start rounded-full transition-all" style={{ width: `${(viralScore.variety / 25) * 100}%` }} /></div>
                                            <div className="flex-1 bg-gray-700/50 rounded-full overflow-hidden"><div className="h-full bg-insta-mid rounded-full transition-all" style={{ width: `${(viralScore.energy / 25) * 100}%` }} /></div>
                                            <div className="flex-1 bg-gray-700/50 rounded-full overflow-hidden"><div className="h-full bg-insta-end rounded-full transition-all" style={{ width: `${(viralScore.pacing / 25) * 100}%` }} /></div>
                                            <div className="flex-1 bg-gray-700/50 rounded-full overflow-hidden"><div className="h-full bg-insta-purple rounded-full transition-all" style={{ width: `${(viralScore.polish / 25) * 100}%` }} /></div>
                                        </div>
                                        <div className="flex justify-between text-[8px] text-gray-500">
                                            <span>Variety {viralScore.variety}</span>
                                            <span>Energy {viralScore.energy}</span>
                                            <span>Pacing {viralScore.pacing}</span>
                                            <span>Polish {viralScore.polish}</span>
                                        </div>
                                        {viralScore.suggestions.length > 0 && (
                                            <div className="space-y-1 pt-1 border-t border-white/5">
                                                {viralScore.suggestions.slice(0, 3).map((s, i) => (
                                                    <p key={i} className="text-[9px] text-gray-400 flex items-start gap-1">
                                                        <span className="text-insta-mid">→</span> {s}
                                                    </p>
                                                ))}
                                            </div>
                                        )}
                                    </div>

                                    {/* AI Auto Direct */}
                                    <button
                                        onClick={handleAutoDirect}
                                        disabled={!media.length || isAutoDirecting}
                                        className="w-full p-3 rounded-xl border border-insta-mid/30 bg-gradient-to-r from-insta-start/20 via-insta-mid/20 to-insta-end/20 hover:from-insta-start/30 hover:via-insta-mid/30 hover:to-insta-end/30 transition disabled:opacity-40 disabled:cursor-not-allowed"
                                    >
                                        <div className="flex items-center justify-center gap-2">
                                            {isAutoDirecting ? (
                                                <>
                                                    <div className="w-3 h-3 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                    <span className="text-xs font-bold text-white">Directing...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <span className="text-base">🎬</span>
                                                    <span className="text-xs font-bold text-white">AI Auto-Direct All Scenes</span>
                                                </>
                                            )}
                                        </div>
                                        <p className="text-[9px] text-gray-400 mt-1 text-center">Analyzes all scenes & applies viral-optimized motion, color, transitions & keyframes</p>
                                    </button>

                                    {/* Per-Scene Director Panel */}
                                    {media.length > 0 && visualSettings.perSceneOverrides && visualSettings.perSceneOverrides[activePreviewSceneIndex] && (
                                        <div className="p-3 bg-black/30 rounded-xl border border-insta-purple/20 space-y-2">
                                            <div className="flex items-center justify-between">
                                                <p className="text-[10px] font-bold text-insta-purple uppercase tracking-wider">Scene {activePreviewSceneIndex + 1} Direction</p>
                                                <button
                                                    onClick={() => handleAutoDirectScene(activePreviewSceneIndex)}
                                                    disabled={isAutoDirecting}
                                                    className="px-2 py-1 rounded text-[9px] font-bold bg-insta-purple/20 text-insta-purple border border-insta-purple/30 hover:bg-insta-purple/30 transition disabled:opacity-40"
                                                >
                                                    {isAutoDirecting ? '...' : '↻ Re-Direct'}
                                                </button>
                                            </div>
                                            {(() => {
                                                const o = visualSettings.perSceneOverrides[activePreviewSceneIndex];
                                                return (
                                                    <div className="grid grid-cols-2 gap-1 text-[9px]">
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Motion:</span><span className="text-gray-300 font-semibold">{o.motionDirection || 'auto'}</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">LUT:</span><span className="text-gray-300 font-semibold">{o.colorLUT || 'none'}</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Transition:</span><span className="text-gray-300 font-semibold">{o.transitionEffect || 'fade'}</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Text:</span><span className="text-gray-300 font-semibold">{o.textAnimation || 'none'}</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Blur:</span><span className="text-gray-300 font-semibold">{Math.round((o.motionBlur || 0) * 100)}%</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Aberr.:</span><span className="text-gray-300 font-semibold">{Math.round((o.chromaticAberration || 0) * 100)}%</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Tilt:</span><span className="text-gray-300 font-semibold">{Math.round((o.perspectiveTilt || 0) * 100)}%</span></div>
                                                        <div className="flex items-center gap-1"><span className="text-gray-500">Intensity:</span><span className="text-gray-300 font-semibold">{Math.round((o.motionIntensity || 0) * 100)}%</span></div>
                                                    </div>
                                                );
                                            })()}
                                            <div className="flex flex-wrap gap-1 pt-1 border-t border-white/5">
                                                {visualSettings.perSceneOverrides[activePreviewSceneIndex]?.enableSubjectTracking && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-insta-mid/20 text-insta-mid">Subject Track</span>}
                                                {visualSettings.perSceneOverrides[activePreviewSceneIndex]?.enableBeatZoom && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-insta-purple/20 text-insta-purple">Beat Zoom</span>}
                                                {visualSettings.sceneKeyframes?.[activePreviewSceneIndex] && <span className="px-1.5 py-0.5 rounded text-[8px] font-bold bg-green-500/20 text-green-400">Keyframes</span>}
                                            </div>
                                        </div>
                                    )}

                                    {/* Advanced Pro Effects */}
                                    <div className="p-3 bg-black/30 rounded-xl border border-white/5 space-y-3">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Pro Effects</p>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Motion Blur</span><span>{Math.round((visualSettings.motionBlur || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="1" step="0.1" className="w-full accent-insta-mid h-1" value={visualSettings.motionBlur || 0} onChange={e => setVisualSettings({ ...visualSettings, motionBlur: parseFloat(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>3D Tilt</span><span>{Math.round((visualSettings.perspectiveTilt || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="1" step="0.1" className="w-full accent-insta-mid h-1" value={visualSettings.perspectiveTilt || 0} onChange={e => setVisualSettings({ ...visualSettings, perspectiveTilt: parseFloat(e.target.value) })} />
                                        </div>
                                        <div>
                                            <div className="flex justify-between text-[10px] text-gray-400 mb-1"><span>Chromatic Aberration</span><span>{Math.round((visualSettings.chromaticAberration || 0) * 100)}%</span></div>
                                            <input type="range" min="0" max="1" step="0.1" className="w-full accent-insta-mid h-1" value={visualSettings.chromaticAberration || 0} onChange={e => setVisualSettings({ ...visualSettings, chromaticAberration: parseFloat(e.target.value) })} />
                                        </div>
                                        <div className="flex flex-wrap gap-2">
                                            <button onClick={() => setVisualSettings({ ...visualSettings, enableSubjectTracking: !visualSettings.enableSubjectTracking })} className={`px-2.5 py-1 rounded text-[9px] font-bold ${visualSettings.enableSubjectTracking ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>Subject Track</button>
                                            <button onClick={() => setVisualSettings({ ...visualSettings, enableBeatZoom: !visualSettings.enableBeatZoom })} className={`px-2.5 py-1 rounded text-[9px] font-bold ${visualSettings.enableBeatZoom ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>Beat Zoom</button>
                                            {visualSettings.enableBeatZoom && <span className="px-2 py-1 rounded text-[9px] font-bold bg-insta-purple/20 text-insta-purple border border-insta-purple/30">Auto-BPM Sync</span>}
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-gray-400 block mb-1.5">Color Grading LUT</label>
                                            <div className="grid grid-cols-4 gap-1.5">
                                                {(['none', 'teal-orange', 'vintage', 'noir', 'golden-hour', 'matrix-green', 'cyberpunk', 'film-stock'] as const).map(lut => (
                                                    <button key={lut} onClick={() => setVisualSettings({ ...visualSettings, colorLUT: lut })} className={`py-1.5 rounded text-[8px] font-bold ${visualSettings.colorLUT === lut ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>
                                                        {lut.replace(/-/g, ' ')}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-gray-400 block mb-1.5">Transition Type</label>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {(['fade', 'slide', 'zoom', 'zoom-blur', 'glitch', 'chromatic', 'none'] as const).map(t => (
                                                    <button key={t} onClick={() => {
                                                        const transitionEffect = t as any;
                                                        setSceneDrafts(prev => prev.map((draft, index) => ({
                                                            ...draft,
                                                            media: { ...(draft.media || media[index]), id: draft.id, sceneId: draft.id, transitionEffect },
                                                        })));
                                                    }} className={`py-1.5 rounded text-[8px] font-bold capitalize ${sceneDrafts.some(d => d.media?.transitionEffect === t) ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>
                                                        {t.replace(/-/g, ' ')}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                        <div>
                                            <label className="text-[10px] text-gray-400 block mb-1.5">Text Animation</label>
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {(['none', 'typewriter', 'bounce-in', 'karaoke-sweep', 'wave', 'glitch-in', 'fade-up'] as const).map(a => (
                                                    <button key={a} onClick={() => setVisualSettings({ ...visualSettings, textAnimation: a })} className={`py-1.5 rounded text-[8px] font-bold ${visualSettings.textAnimation === a ? 'bg-insta-mid text-white' : 'bg-black/30 text-gray-400'}`}>
                                                        {a.replace(/-/g, ' ')}
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Keyframe Timeline */}
                                    <KeyframeTimeline
                                        sceneIndex={activePreviewSceneIndex}
                                        keyframes={visualSettings.sceneKeyframes || {}}
                                        onChange={(kf) => setVisualSettings({ ...visualSettings, sceneKeyframes: kf })}
                                    />

                                    {/* Quick Actions */}
                                    <div className="space-y-2">
                                        <p className="text-[10px] font-bold text-gray-500 uppercase tracking-wider">Quick Presets</p>
                                        <button onClick={() => { setVisualSettings({ ...visualSettings, filterPreset: 'cinematic', contrast: 1.1, saturation: 0.9, vignette: 0.3, grain: 0.06, motionDirection: 'random', motionIntensity: 0.5, enableParallax: true, enableParticles: true, enableLightLeaks: true, enableZoom: true }); setSubtitleSettings({ ...subtitleSettings, style: 'clean', fontFamily: 'Playfair Display' }); }} className="w-full p-3 rounded-xl border border-gray-700 text-left hover:border-insta-mid transition">
                                            <p className="text-xs font-semibold">Cinematic</p>
                                            <p className="text-[10px] text-gray-500">Film look, parallax depth, grain, light leaks</p>
                                        </button>
                                        <button onClick={() => { setVisualSettings({ ...visualSettings, filterPreset: 'vibrant', saturation: 1.3, contrast: 1.1, motionDirection: 'zoom-in', motionIntensity: 0.7, enableParallax: true, enableParticles: true, enableLightLeaks: false, enableZoom: true, grain: 0 }); setSubtitleSettings({ ...subtitleSettings, style: 'viral', fontFamily: 'Montserrat', uppercase: true }); }} className="w-full p-3 rounded-xl border border-gray-700 text-left hover:border-insta-mid transition">
                                            <p className="text-xs font-semibold">Viral Pop</p>
                                            <p className="text-[10px] text-gray-500">Bold zoom, punchy parallax, attention-grabbing</p>
                                        </button>
                                        <button onClick={() => { setVisualSettings({ ...visualSettings, filterPreset: 'moody', brightness: 0.9, contrast: 1.2, vignette: 0.4, grain: 0.08, motionDirection: 'breathing', motionIntensity: 0.3, enableParallax: true, enableParticles: true, enableLightLeaks: true, enableZoom: true }); setSubtitleSettings({ ...subtitleSettings, style: 'clean', fontFamily: 'Merriweather' }); }} className="w-full p-3 rounded-xl border border-gray-700 text-left hover:border-insta-mid transition">
                                            <p className="text-xs font-semibold">Story Mode</p>
                                            <p className="text-[10px] text-gray-500">Gentle breathing motion, atmospheric, emotional</p>
                                        </button>
                                        <button onClick={() => { setVisualSettings({ brightness: 1, contrast: 1, saturation: 1, enableZoom: false, filterPreset: 'none', vignette: 0, grain: 0, motionDirection: 'random', motionIntensity: 0, enableParallax: false, enableParticles: false, enableLightLeaks: false }); setSubtitleSettings({ ...DEFAULT_SUBTITLE_SETTINGS }); setAudioMix({ ...DEFAULT_AUDIO_MIX_SETTINGS }); }} className="w-full p-3 rounded-xl border border-red-500/30 text-left hover:border-red-500 transition">
                                            <p className="text-xs font-semibold text-red-400">Reset All</p>
                                            <p className="text-[10px] text-gray-500">Back to defaults, motion off</p>
                                        </button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </section>
            )}

            {step === AppStep.EXPORT && (script || creationMode === CreationMode.SONG_TO_VIDEO) && (
                <section className="relative min-h-[calc(100vh-96px)] py-10 px-6 overflow-hidden flex items-center">
                    <div className="absolute inset-0 bg-gradient-to-br from-[#020307] via-[#0A0E20] to-[#1B0A2E]"></div>
                    <div className="relative z-10 max-w-7xl mx-auto w-full grid grid-cols-1 lg:grid-cols-12 gap-8 items-stretch">
                        <div className="lg:col-span-6 bg-black/40 rounded-[32px] border border-white/10 p-6 shadow-[0_30px_100px_-60px_rgba(0,0,0,1)] flex flex-col">
                            <div className="flex items-center justify-between mb-4">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.4em] text-white/40">Render Preview</p>
                                    <h3 className="text-2xl font-black">Final check</h3>
                                </div>
                                <button onClick={() => setStep(AppStep.PREVIEW)} className="px-4 py-2 rounded-xl border border-white/20 text-white/70 hover:text-white">Back</button>
                            </div>
                            <div className="flex-1 flex items-center justify-center">
                                <div
                                    className="w-full aspect-[9/16] rounded-[28px] overflow-hidden ring-1 ring-white/10"
                                    style={{ width: 'min(100%, min(480px, calc(70vh * 9 / 16)))' }}
                                >
                                    <ErrorBoundary>
                                        <ReelPreview
                                            media={media}
                                            script={script}
                                            audioBuffer={audioBuffer}
                                            audioPlaybackRate={voiceTimelinePlaybackRate}
                                            bgMusicBuffer={bgMusicBuffer}
                                            isPlaying={isPlaying}
                                            onPlayToggle={() => setIsPlaying(!isPlaying)}
                                            onRestart={() => setIsPlaying(false)}
                                            videoSpeed={videoSpeed}
                                            visualSettings={visualSettings}
                                            subtitleSettings={subtitleSettings}
                                            audioMixSettings={audioMix}
                                            slideDurations={slideDurations}
                                            audioSegmentDurations={audioSegmentDurations}
                                            enableCaptions={enableCaptions}
                                            exportPresets={availableExportPresets}
                                            autoExportPresetId={selectedExportPresetId}
                                            exportTriggerKey={exportTriggerKey}
                                            onVideoSpeedChange={setVideoSpeed}
                                            onSceneChange={setActivePreviewSceneIndex}
                                        />
                                    </ErrorBoundary>
                                </div>
                            </div>
                        </div>

                        <div className="lg:col-span-6 bg-white/5 border border-white/10 rounded-[32px] p-8 space-y-6 backdrop-blur-xl flex flex-col overflow-hidden">
                            <div className="flex items-center justify-between">
                                <div>
                                    <p className="text-xs uppercase tracking-[0.3em] text-white/40 font-medium mb-1">Export Presets</p>
                                    <h3 className="text-3xl font-black tracking-tight bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple text-transparent bg-clip-text">Choose destination</h3>
                                </div>
                                <button onClick={() => setStep(AppStep.PREVIEW)} className="text-sm font-medium text-white/60 hover:text-white transition-colors">← Preview</button>
                            </div>

                            <div className="flex-1 overflow-hidden">
                                <div className="space-y-3 h-full overflow-y-auto pr-2 custom-scrollbar">
                                    {availableExportPresets.map(preset => (
                                        <button
                                            key={preset.id}
                                            onClick={() => setSelectedExportPresetId(preset.id)}
                                            className={`w-full text-left p-4 rounded-xl border transition-all duration-300 flex items-center justify-between gap-4 group ${selectedExportPresetId === preset.id ? 'border-insta-purple/50 bg-gradient-to-r from-insta-purple/20 to-insta-mid/10 text-white shadow-[0_0_30px_-10px_rgba(188,24,136,0.3)]' : 'border-white/10 text-white/60 hover:border-white/30 hover:bg-white/5'} `}
                                        >
                                            <div>
                                                <p className={`text-lg font-bold ${selectedExportPresetId === preset.id ? 'text-white' : 'text-white/90 group-hover:text-white'}`}>{preset.label}</p>
                                                <p className="text-xs text-white/50 mt-0.5">{preset.description}</p>
                                            </div>
                                            <div className="text-right text-xs text-white/40 font-mono">
                                                <p>{preset.aspectRatio} · {preset.width}×{preset.height}</p>
                                                <p>{preset.format.toUpperCase()} · {(preset.videoBitrate || 0) / 1_000_000 || 'Auto'} Mbps</p>
                                            </div>
                                        </button>
                                    ))}
                                </div>
                            </div>

                            {storyboardContinuitySummary.sceneCount > 0 && (
                                <div className="p-5 rounded-2xl border border-insta-mid/20 bg-gradient-to-r from-insta-start/10 via-white/5 to-insta-purple/10 backdrop-blur-sm">
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-insta-mid/80 mb-2 font-bold">Campaign Summary</p>
                                    <div className="flex flex-wrap gap-2 mb-3">
                                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/75">
                                            {storyboardContinuitySummary.sceneCount} scenes
                                        </span>
                                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/75">
                                            {storyboardContinuitySummary.productLanes.length || 1} product lane{(storyboardContinuitySummary.productLanes.length || 1) === 1 ? '' : 's'}
                                        </span>
                                        <span className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/75">
                                            {storyboardContinuitySummary.assetBackedCount} asset-backed
                                        </span>
                                    </div>
                                    <div className="space-y-2">
                                        {storyboardContinuitySummary.productLanes.slice(0, 4).map((lane) => (
                                            <div key={lane.label} className="flex items-center justify-between text-sm">
                                                <span className="text-white/80 truncate">{lane.label}</span>
                                                <span className="text-white/50">{lane.count} scene{lane.count === 1 ? '' : 's'}</span>
                                            </div>
                                        ))}
                                    </div>
                                    {storyboardContinuitySummary.routeBuckets.length > 0 && (
                                        <div className="mt-3 flex flex-wrap gap-2">
                                            {storyboardContinuitySummary.routeBuckets.map((route) => (
                                                <span key={route.label} className="rounded-full border border-white/10 bg-black/30 px-3 py-1 text-[10px] text-white/70">
                                                    {route.label} · {route.count}
                                                </span>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {selectedExportPreset && (
                                <div className="p-5 rounded-2xl border border-white/10 bg-black/40 backdrop-blur-sm">
                                    <p className="text-[10px] uppercase tracking-[0.3em] text-white/30 mb-2 font-bold">Ready to Export</p>
                                    <div className="flex items-center justify-between">
                                        <div>
                                            <p className="text-xl font-bold text-white">{selectedExportPreset.label}</p>
                                            <p className="text-sm text-white/50">{selectedExportPreset.description}</p>
                                        </div>
                                        <div className="text-2xl opacity-50">✨</div>
                                    </div>
                                </div>
                            )}

                            <button
                                onClick={() => {
                                    setExportTriggerKey(prev => prev + 1);
                                    showNotice('Rendering export…', 'info');
                                    logReelHistory('assets_generated', {
                                        metadata: {
                                            stage: 'export',
                                            preset: selectedExportPreset?.label,
                                            scenes: media.length,
                                            scriptLength: script?.segments.length
                                        }
                                    });
                                }}
                                className="w-full py-5 rounded-2xl bg-gradient-to-r from-insta-start via-insta-mid to-insta-purple text-white font-black text-xl shadow-[0_20px_40px_-15px_rgba(188,24,136,0.5)] hover:shadow-[0_20px_60px_-10px_rgba(188,24,136,0.6)] hover:-translate-y-1 hover:scale-[1.01] active:scale-[0.98] transition-all duration-300 relative overflow-hidden group"
                            >
                                <span className="relative z-10 flex items-center justify-center gap-2">
                                    Render & Download
                                    <svg className="w-5 h-5 group-hover:translate-x-1 transition-transform" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2.5" d="M17 8l4 4m0 0l-4 4m4-4H3"></path></svg>
                                </span>
                            </button>
                        </div>
                    </div>
                </section>
            )}

            {/* Standalone Video Editor */}
            {step === AppStep.VIDEO_EDITOR && (
                media.length === 0 ? (
                    <section className="relative min-h-[calc(100vh-64px)] flex items-center justify-center py-12 px-6 overflow-hidden">
                        <div className="absolute inset-0 bg-gradient-to-br from-[#05070F] via-[#0F1222] to-[#12051A]"></div>
                        <div className="relative z-10 max-w-2xl w-full space-y-8 text-center">
                            <div>
                                <p className="text-xs uppercase tracking-[0.4em] text-white/40 mb-3">Video Editor</p>
                                <h2 className="text-4xl font-black">Upload your clips</h2>
                                <p className="text-white/60 mt-2">Drop videos or images to start editing in the timeline.</p>
                            </div>

                            <div
                                className="border-2 border-dashed border-white/20 rounded-3xl p-12 hover:border-insta-mid/50 transition cursor-pointer"
                                onClick={() => document.getElementById('video-editor-upload')?.click()}
                                onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('border-insta-mid', 'bg-insta-mid/10'); }}
                                onDragLeave={(e) => { e.currentTarget.classList.remove('border-insta-mid', 'bg-insta-mid/10'); }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.currentTarget.classList.remove('border-insta-mid', 'bg-insta-mid/10');
                                    const files = Array.from(e.dataTransfer.files || []).filter((file): file is File => file instanceof File);
                                    handleVideoEditorUpload(files);
                                }}
                            >
                                <div className="text-6xl mb-4">🎬</div>
                                <p className="text-lg font-semibold">Drop files here</p>
                                <p className="text-sm text-white/50 mt-2">or click to browse</p>
                                <input
                                    type="file"
                                    id="video-editor-upload"
                                    className="hidden"
                                    accept="video/*,image/*"
                                    multiple
                                    onChange={(e) => {
                                        const files = Array.from(e.target.files || []).filter((file): file is File => file instanceof File);
                                        handleVideoEditorUpload(files);
                                    }}
                                />
                            </div>

                            <button
                                onClick={() => setStep(AppStep.LANDING)}
                                className="text-white/60 hover:text-white transition text-sm"
                            >
                                ← Back to Home
                            </button>
                        </div>
                    </section>
                ) : (
                    <VideoExtensionStudio
                        media={media}
                        script={null}
                        onBack={clearWorkspaceMedia}
                        onUpdateMedia={handleStudioMediaUpdate}
                        onContinue={() => setStep(AppStep.EXPORT)}
                        onUpdateDuration={handleUpdateClipDuration}
                        onBulkUpdateDuration={handleBulkUpdateClipDuration}
                        onFitDurationsToTarget={handleFitDurationsToTarget}
                        onApplyRolePreset={handleApplyRolePreset}
                        onSetPacingRole={handleSetClipPacingRole}
                        onTogglePacingLock={handleToggleClipPacingLock}
                        onRippleDurationChange={handleRippleDurationChange}
                        pacingScenes={pacingScenes}
                        targetDuration={resolveEffectiveTargetDuration(targetDuration) || undefined}
                    />
                )
            )}

            {/* Voice Recorder Modal */}
            {showVoiceRecorder && (
                <div className="fixed inset-0 z-[100] bg-black/90 backdrop-blur-md flex items-center justify-center p-4">
                    <div className="w-full max-w-2xl h-[80vh] bg-dark-card border border-dark-border rounded-3xl p-8 relative">
                        <button
                            onClick={() => setShowVoiceRecorder(false)}
                            className="absolute top-4 right-4 text-gray-400 hover:text-white"
                        >
                            <svg className="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" /></svg>
                        </button>
                        <VoiceRecorder
                            onRecordingComplete={handleVoiceRecordingComplete}
                            onCancel={() => setShowVoiceRecorder(false)}
                            scriptText={script?.segments.join('\n\n')}
                        />
                    </div>
                </div>
            )}
        </div>
    );
};

export default App;
