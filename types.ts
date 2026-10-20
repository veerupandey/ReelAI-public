
import type { AssetProvenanceRole, AssetProvenanceStep, SceneRoute, SceneSourceMode, SceneVisualTask } from './types/brand';
import type { KeyframeTrack } from './utils/motionEngine';

export interface ApprovedStoryboardSceneMetadata {
  productId?: string;
  productTitle?: string;
  productUrl?: string;
  storyboardRoute?: SceneRoute;
  storyboardRouteOverride?: SceneRoute;
  storyboardRouteReason?: string;
  storyboardSourceMode?: SceneSourceMode;
  storyboardVisualTask?: SceneVisualTask;
  storyboardVisualTaskReason?: string;
  storyboardSuggestedPosition?: number;
  storyboardBaseAssetId?: string;
  storyboardBaseAssetDescription?: string;
  storyboardLinkedAssetId?: string;
  storyboardLinkedAssetDescription?: string;
  storyboardDirectorsNote?: string;
  referenceImageBase64?: string;
  referenceImageMimeType?: string;
}

export interface SceneReferenceBinding {
  assetId: string;
  source: 'brand_asset' | 'scene_variant' | 'external_image';
  role: AssetProvenanceRole;
  label: string;
  description?: string;
  previewUrl?: string;
  mimeType?: string;
  base64?: string;
  sourceSceneId?: string;
  variantId?: string;
}

export interface UploadedMedia extends ApprovedStoryboardSceneMetadata {
  id?: string;
  name?: string;
  src?: string;
  thumbnail?: string;
  file: File;
  previewUrl: string;
  thumbnailUrl?: string;
  type: 'image' | 'video';
  base64?: string;
  mimeType: string;
  duration: number; // Duration in seconds
  shortsPackIndex?: number; // optional grouping for AI-generated shorts
  startTime?: number; // Start time for virtual clip
  endTime?: number; // End time for virtual clip
  description?: string; // Optional context description
  imagePrompt?: string; // The AI prompt used to generate this image (if applicable)
  transitionEffect?: TransitionEffect; // Per-clip transition
  playbackRate?: number; // Custom playback speed per clip
  holdFrameStrategy?: 'freeze' | 'loop' | 'slowmo';
  extendedDuration?: number; // manual extension target
  captions?: CaptionBlock[];
  extensionAnchor?: number; // seconds from clip start to hold/loop during extensions
  extensionLoopDuration?: number; // duration of motion loop when holdFrameStrategy=loop
  sceneId?: string;
  assetOrigin?: 'user_upload' | 'generated' | 'brand_asset' | 'brand_edit' | 'brand_upload';
  brandAssetId?: string;
  sceneReferenceBindings?: SceneReferenceBinding[];
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
  aiFramingMode?: 'cover' | 'contain';
  aiFramingFocusY?: number;
  aiPresentationReason?: string;
}

export type TransitionEffect = 'none' | 'fade' | 'slide' | 'zoom';

export interface VisualSettings {
  brightness: number;
  contrast: number;
  saturation: number;
  enableZoom: boolean;
  filterPreset?: FilterPreset;
  vignette?: number; // 0-1, intensity of dark edges
  speed?: number; // 0.5-2.0, playback speed
  grain?: number; // 0-1, film grain intensity
  framingMode?: 'cover' | 'contain'; // cover fills frame, contain letterboxes
  framingFocusY?: number; // 0 (top) - 1 (bottom) crop focus for cover mode
  motionDirection?: 'random' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'zoom-pan-tl' | 'zoom-pan-br' | 'zoom-pan-tr' | 'zoom-pan-bl' | 'breathing';
  motionIntensity?: number; // 0-1, controls zoom/pan amount
  enableParallax?: boolean; // depth-based 2.5D parallax
  enableParticles?: boolean; // dust motes + light leaks
  enableLightLeaks?: boolean; // cinematic light leak overlays
  // Advanced CapCut-grade features
  motionBlur?: number; // 0-1, directional blur based on camera velocity
  enableSubjectTracking?: boolean; // camera follows segmented subject
  chromaticAberration?: number; // 0-1, RGB split intensity
  enableBeatZoom?: boolean; // audio-reactive zoom pulse on beats
  perspectiveTilt?: number; // 0-1, 3D tilt amount
  colorLUT?: 'none' | 'teal-orange' | 'vintage' | 'noir' | 'golden-hour' | 'matrix-green' | 'cyberpunk' | 'film-stock';
  textAnimation?: 'none' | 'typewriter' | 'bounce-in' | 'karaoke-sweep' | 'wave' | 'glitch-in' | 'fade-up';
  transitionEffect?: 'fade' | 'slide' | 'zoom' | 'none' | 'zoom-blur' | 'glitch' | 'chromatic';
  sceneKeyframes?: { [sceneIndex: number]: KeyframeTrack[] };
  perSceneOverrides?: { [sceneIndex: number]: SceneVisualOverride };
}

export interface SceneVisualOverride {
  colorLUT?: 'none' | 'teal-orange' | 'vintage' | 'noir' | 'golden-hour' | 'matrix-green' | 'cyberpunk' | 'film-stock';
  transitionEffect?: 'fade' | 'slide' | 'zoom' | 'none' | 'zoom-blur' | 'glitch' | 'chromatic';
  textAnimation?: 'none' | 'typewriter' | 'bounce-in' | 'karaoke-sweep' | 'wave' | 'glitch-in' | 'fade-up';
  motionBlur?: number;
  chromaticAberration?: number;
  perspectiveTilt?: number;
  enableSubjectTracking?: boolean;
  enableBeatZoom?: boolean;
  motionDirection?: 'random' | 'zoom-in' | 'zoom-out' | 'pan-left' | 'pan-right' | 'pan-up' | 'pan-down' | 'zoom-pan-tl' | 'zoom-pan-br' | 'zoom-pan-tr' | 'zoom-pan-bl' | 'breathing';
  motionIntensity?: number;
}

export interface CaptionBlock {
  id: string;
  text: string;
  startTime: number;
  endTime: number;
  position?: 'top' | 'middle' | 'bottom' | 'custom';
  xPercent?: number;
  yPercent?: number;
  stylePreset?: CaptionStylePreset;
  fontFamily?: string;
  fontSize?: number;
  color?: string;
  backgroundColor?: string;
  animation?: 'none' | 'fade' | 'slide' | 'pop' | 'typewriter';
}

export type CaptionStylePreset = 'bold-pop' | 'minimal' | 'cinematic' | 'outline' | 'emoji';

export type FilterPreset = 'none' | 'cinematic' | 'vibrant' | 'noir' | 'warm' | 'cool' | 'vintage' | 'moody';

export interface SubtitleSettings {
  style: CaptionStyle;
  fontSize: number; // 16-48
  yPosition: number; // 10-90 (percent from top)
  color?: string; // Hex/primary fill color
  fontFamily?: string;
  animation?: CaptionAnimation;
  strokeWidth?: number; // 0-12
  shadowBlur?: number; // 0-20
  textAlign?: 'left' | 'center' | 'right';
  uppercase?: boolean;
  letterSpacing?: number; // 0-10
  // NEW: State-of-the-art features
  displayMode?: 'sentence' | 'word-by-word'; // Karaoke vs full sentence
  outlineColor?: string; // Separate outline color
  fillColor?: string; // Text fill (can differ from outline)
  highlightColor?: string; // Word-by-word highlight color
  glowColor?: string; // Neon glow color
  glowIntensity?: number; // 0-20 glow spread
  backgroundShape?: 'none' | 'box' | 'pill' | 'bubble' | 'highlight';
  backgroundOpacity?: number; // 0-1
  gradientColors?: [string, string]; // For gradient text fill
  emojiStyle?: 'none' | 'auto' | 'custom';
  popScale?: number; // 1.0-1.5 for bounce/pop effect
  wordSpacing?: number; // Extra spacing between words
}

export type CaptionStyle =
  | 'viral'      // Bold stroke, high contrast
  | 'clean'      // Minimal, elegant
  | 'box'        // Background box
  | 'gradient'   // Gradient text fill
  | 'neon'       // Glowing neon effect
  | 'karaoke'    // Word-by-word highlight
  | 'outline'    // Thick outline, no fill
  | 'shadow'     // Drop shadow style
  | 'bubble'     // Speech bubble background
  | 'highlight'  // Marker highlight effect
  | 'cinematic'; // Film-style subtitles

export type CaptionAnimation =
  | 'none'
  | 'fade'
  | 'pop'        // Scale bounce
  | 'typewriter' // Letter by letter
  | 'slide'      // Slide in
  | 'bounce'     // Bouncy entrance
  | 'wave'       // Wave effect per word
  | 'shake'      // Shake/vibrate
  | 'zoom'       // Zoom in
  | 'shimmer'    // Horizontal shimmer sweep - trending 2024
  | 'colorShift' // Color cycling/pulsing effect
  | 'pulse';     // Scale breathing effect

export interface AudioMixSettings {
  voiceVolume: number; // 0-1.5
  musicVolume: number; // 0-1
  /** Original clip / video soundtrack level (0-1). Preview + export. */
  clipVolume?: number;
  fadeInDuration?: number; // seconds
  fadeOutDuration?: number; // seconds
  enableDucking?: boolean; // auto-lower music/clip when voice plays
  duckingAmount?: number; // 0-1, how much to reduce music/clip
  voiceTimingMode?: 'natural' | 'fit_timeline';
}

/** Production default captions — bold, readable, Shorts/Reels ready. */
export const DEFAULT_SUBTITLE_SETTINGS: SubtitleSettings = {
  style: 'viral',
  fontSize: 38,
  yPosition: 75,
  fontFamily: 'Montserrat',
  color: '#FFFFFF',
  fillColor: '#FFFFFF',
  outlineColor: '#000000',
  highlightColor: '#FFFF00',
  glowColor: '#FFFF00',
  displayMode: 'word-by-word',
  animation: 'pop',
  backgroundShape: 'none',
  letterSpacing: 0,
  strokeWidth: 8,
  uppercase: true,
};

export const DEFAULT_AUDIO_MIX_SETTINGS: AudioMixSettings = {
  voiceVolume: 1.0,
  musicVolume: 0.2,
  // Keep clip audio present but below VO by default (was 1.0 and drowned narration).
  clipVolume: 0.25,
  voiceTimingMode: 'fit_timeline',
  enableDucking: true,
  duckingAmount: 0.55,
  fadeInDuration: 0,
  fadeOutDuration: 0,
};

export interface VisualAsset {
  file: File;
  base64: string;
  mimeType: string;
  previewUrl: string;
  assetId?: string;
  description?: string;
  productIdentity?: string;
  shotType?: string;
}

export type CaptionMode = 'derived' | 'manual';
export type SceneImageSource = 'generated' | 'uploaded' | 'brand_asset' | 'brand_edit';
export type SceneArtifactStatus = 'clean' | 'stale' | 'generating' | 'error';
export type VoiceProvider = 'gemini' | 'google';

export interface VoiceOption {
  provider: VoiceProvider;
  id: string;
  label: string;
  locale: string;
  gender: 'Male' | 'Female';
  description?: string;
  accentHint?: string;
}

export interface BrandAssetCatalogEntry {
  assetId: string;
  source: 'logo' | 'product';
  semanticDescription: string;
  productIdentity: string;
  shotType: 'logo' | 'packshot' | 'lifestyle' | 'detail' | 'unknown';
  imageIndex?: number;
  framingMode?: 'cover' | 'contain';
  framingFocusY?: number;
  presentationReason?: string;
}

export interface ImageReferenceInput {
  data: string;
  mimeType?: string;
  assetId?: string;
}

export interface ImageGenerationRequest {
  mode: 'generate' | 'edit' | 'composite';
  imagePrompt: string;
  visualDescription?: string;
  brandContext?: string;
  aspectRatio?: string;              // e.g. '9:16', '4:5', '1:1'. Defaults to '9:16' if omitted.
  primaryReference?: ImageReferenceInput;
  prevSceneReference?: ImageReferenceInput;
  nextSceneReference?: ImageReferenceInput;
  references?: Array<{
    input: ImageReferenceInput;
    role: AssetProvenanceRole;
    preserve?: string[];
    modify?: string;
  }>;
  prevSceneText?: string;
  currentSceneText?: string;
  nextSceneText?: string;
  /**
   * Exact copy the image IS allowed (and expected) to render on-image,
   * e.g. a social post headline/CTA. When empty or omitted, the pipeline
   * enforces its default NO TEXT rule.
   */
  allowedOnImageText?: string[];
  /**
   * Continuity prompt flavor for edit/reference modes.
   * - product: preserve packaging/label identity (default for brand ads)
   * - character: preserve person/wardrobe/face for music-video sequences
   */
  continuityDomain?: 'product' | 'character';
  /** Skip the Flash prompt-QA pass when the caller already curated the prompt. */
  skipPromptReview?: boolean;
}

export interface SceneGenerationStatus {
  script: SceneArtifactStatus;
  image: SceneArtifactStatus;
  voice: SceneArtifactStatus;
}

export interface SceneVoiceAsset {
  provider: VoiceProvider;
  voiceId: string;
  textHash: string;
  durationSec: number;
}

export interface SceneImageVariant {
  id: string;
  label: string;
  imageSource: SceneImageSource;
  createdAt: string;
  media: UploadedMedia;
  brandAssetId?: string;
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}

export type ScenePacingRole = 'hook' | 'body' | 'cta' | 'other';

export type VoiceSlotMeterStatus = 'ok' | 'tight' | 'extreme' | 'missing';

export interface SceneDraft extends ApprovedStoryboardSceneMetadata {
  id: string;
  sceneNumber: number;
  visualDescription: string;
  imagePrompt: string;
  voiceoverText: string;
  onScreenText: string;
  requestedDurationSec: number;
  resolvedDurationSec: number;
  imageSource: SceneImageSource;
  captionMode: CaptionMode;
  generationStatus: SceneGenerationStatus;
  /** Editor pacing role; when set, wins over script-text inference. */
  pacingRole?: ScenePacingRole;
  /** When true, fit/ripple leave this scene's duration fixed. */
  pacingLocked?: boolean;
  media?: UploadedMedia;
  imageVariants?: SceneImageVariant[];
  activeVariantId?: string;
  manualCaptions?: CaptionBlock[];
  brandImageIndex?: number;
  brandAssetEditAction?: 'edit' | 'use_as_is';
  brandAssetId?: string;
  sceneReferenceBindings?: SceneReferenceBinding[];
  voiceAsset?: SceneVoiceAsset;
  sourceAssetIds?: string[];
  provenance?: AssetProvenanceStep[];
}

export interface BrandKit {
  hexColor?: string;
  websiteUrl?: string; // Legacy single-site support
  websiteUrls?: string[];
  logo?: VisualAsset; // Legacy single-logo support
  logos?: VisualAsset[];
  productImages?: VisualAsset[];
  brandNotes?: string;
  brandNotesList?: string[]; // New field for multiple brand notes
  aestheticAnalysis?: string;
  visualSignature?: string; // Specific physical description for image generation
  assetCatalog?: BrandAssetCatalogEntry[];
}

export interface ReelScript {
  title: string;
  hook: string;
  body: string;
  callToAction: string;
  fullText: string;
  segments: string[];
  segmentPlans?: ReelScriptSegmentPlan[];
  musicSuggestion?: {
    mood: string;
    genre: string;
    description: string;
    searchQuery: string;
  };
  suggestedVisuals?: {
    brightness: number;
    contrast: number;
    saturation: number;
    enableZoom: boolean;
    reasoning: string;
  };
  suggestedSpeed?: number;
}

export interface ReelScriptSegmentPlan {
  index: number;
  onScreenText: string;
  voiceoverText: string;
  visualBeat: string;
  durationSec: number;
  brollKeywords?: string[];
}

export interface GeneratedMusicTrack {
  id: string;
  name: string;
  buffer: AudioBuffer;
  description: string;
  createdAt: number;
  origin?: 'generated' | 'uploaded';
  analysis?: MusicAnalysis;
}

export interface AudioState {
  audioBuffer: AudioBuffer | null;
  blob: Blob | null;
  url: string | null;
  isLoading: boolean;
}

export enum CreationMode {
  MEDIA_UPLOAD = 'MEDIA_UPLOAD',
  TEXT_TO_REEL = 'TEXT_TO_REEL',
  EDIT_EXISTING = 'EDIT_EXISTING',
  SONG_TO_VIDEO = 'SONG_TO_VIDEO',
  BRAND_VIDEO = 'BRAND_VIDEO',
  AGENT_CONSOLE = 'AGENT_CONSOLE',
  AGENT_HUB = 'AGENT_HUB',
  IMAGE_STUDIO = 'IMAGE_STUDIO',
}

export enum AppStep {
  LANDING = 'LANDING',
  TOPIC_INPUT = 'TOPIC_INPUT',
  GENERATING_ASSETS = 'GENERATING_ASSETS',
  REVIEW_PLAN = 'REVIEW_PLAN',
  UPLOAD = 'UPLOAD',
  SEGMENTATION = 'SEGMENTATION',
  VIDEO_EXTENSION = 'VIDEO_EXTENSION',
  ANALYZE_SCRIPT = 'ANALYZE_SCRIPT',
  GENERATE_AUDIO = 'GENERATE_AUDIO',
  PREVIEW = 'PREVIEW',
  EXPORT = 'EXPORT',
  VIDEO_EDITOR = 'VIDEO_EDITOR', // Standalone video editing mode
  SONG_UPLOAD = 'SONG_UPLOAD',
  SONG_ANALYSIS = 'SONG_ANALYSIS',
  SONG_VISUAL_GENERATION = 'SONG_VISUAL_GENERATION',
  SONG_VIDEO_ASSEMBLY = 'SONG_VIDEO_ASSEMBLY',
  // Brand Video Creator
  BRAND_HUB = 'BRAND_HUB',
  BRAND_CAMPAIGN_BRIEF = 'BRAND_CAMPAIGN_BRIEF',
  BRAND_AGENTS_WORKING = 'BRAND_AGENTS_WORKING',
  BRAND_CONCEPT_REVIEW = 'BRAND_CONCEPT_REVIEW',
  BRAND_GENERATING = 'BRAND_GENERATING',
}

export interface VideoExtensionRequest {
  segmentId: number;
  desiredDuration: number;
  reason?: string;
}

export interface ExportPreset {
  id: string;
  label: string;
  description: string;
  aspectRatio: '9:16' | '1:1' | '16:9';
  width: number;
  height: number;
  format: 'mp4' | 'mov' | 'webm' | 'gif' | 'aac';
  videoBitrate?: number;
  audioBitrate?: number;
}

/** Gemini prebuilt TTS voice ids (+ regional aliases mapped in geminiService). */
export enum VoiceName {
  Puck = 'Puck',
  Charon = 'Charon',
  Kore = 'Kore',
  Fenrir = 'Fenrir',
  Zephyr = 'Zephyr',
  Aoede = 'Aoede',
  Leda = 'Leda',
  Orus = 'Orus',
  Callirrhoe = 'Callirrhoe',
  Autonoe = 'Autonoe',
  Enceladus = 'Enceladus',
  Iapetus = 'Iapetus',
  Umbriel = 'Umbriel',
  Algieba = 'Algieba',
  Despina = 'Despina',
  Erinome = 'Erinome',
  Algenib = 'Algenib',
  Rasalgethi = 'Rasalgethi',
  Laomedeia = 'Laomedeia',
  Achernar = 'Achernar',
  Alnilam = 'Alnilam',
  Schedar = 'Schedar',
  Gacrux = 'Gacrux',
  Pulcherrima = 'Pulcherrima',
  Achird = 'Achird',
  Zubenelgenubi = 'Zubenelgenubi',
  Vindemiatrix = 'Vindemiatrix',
  Sadachbia = 'Sadachbia',
  Sadaltager = 'Sadaltager',
  Sulafat = 'Sulafat',
  // Regional aliases → remapped to prebuilt voices in getGeminiVoiceId
  Rishi = 'Rishi',
  Mira = 'Mira',
  Hikaru = 'Hikaru',
}

export enum ScriptStyle {
  Professional = 'Professional',
  GenZ = 'Gen Z / Trendy',
  IndianDesi = 'Indian Desi (Hinglish)',
  CanadianDesi = 'Canadian Desi (Punjabi Slang)',
  Luxury = 'Luxury / Cinematic',
  Emotional = 'Emotional / Storytelling',
  Funny = 'Funny / Sarcastic',
  Motivational = 'Motivational / Gym',
  ASMR = 'ASMR / Soothing'
}

export interface Note {
  pitch: string;
  startTime: number;
  duration: number;
  velocity?: number;
}

export interface MusicComposition {
  trackName: string;
  bpm: number;
  notes: Note[];
  totalDuration: number;
}

export interface MusicMetadata {
  duration: number;
  rms: number;
  estimatedBpm: number;
  peakMoments: number[];
}

export interface MusicAnalysisSection {
  label: string;
  description: string;
  timestamp?: number;
}

export interface MusicAnalysis {
  vibe: string;
  pacingAdvice: string;
  bpmEstimate: number;
  beatMoments: number[];
  sections: MusicAnalysisSection[];
}

export interface VoiceMatchResponse {
  selectedVoice: VoiceName | string;
  reasoning: string;
  detectedGender: string;
  detectedTone: string;
}

export interface VideoSegment {
  startTime: number;
  endTime: number;
  description: string;
  reasoning: string;
  confidence?: number;
}

export interface TrendReport {
  viralHooks: string[];
  visualStyle: string;
  trendingAudio: string;
  optimalDuration: number;
}

export interface ResearchReport {
  keyFacts: string[];
  commonMyths: string[];
  stepByStep?: string[];
  depthScore: number;
}

export interface ViralAnalysisReport {
  winningFormat: string; // e.g., "ASMR Intro -> Problem -> Solution"
  visualHooks: string[]; // e.g., "Macro shot of texture"
  audioSignature: string; // e.g., "Crunchy sounds"
  mistakesToAvoid: string[];
}

export interface ViralTopicPersonaSnapshot {
  personaLabel: string;
  tone: string;
  audience: string;
  painPoints: string[];
  preferredPlatforms: string[];
  recommendedMoves: string[];
}

export interface ViralTopicIdea {
  id: string;
  title: string;
  hook: string;
  angle: string;
  trendReason: string;
  hashtagStack: string[];
  referenceCreators: string[];
  callToAction: string;
  personaNotes?: {
    tone: string;
    vibe: string;
    audience: string;
  };
  storyStarter?: string;
  scriptStarter?: string;
  rawTopicLine?: string;
}

export interface ViralTopicFinderResult {
  personaSummary: ViralTopicPersonaSnapshot;
  freshnessRadar?: string[];
  globalHashtags: string[];
  trendInsights: string[];
  ideas: ViralTopicIdea[];
}

export type SocialPlatform =
  | 'instagram'
  | 'youtube'
  | 'tiktok'
  | 'facebook'
  | 'linkedin'
  | 'pinterest'
  | 'twitter';

export interface SocialCopySuggestion {
  platform: SocialPlatform;
  caption: string;
  hashtags: string[];
  notes?: string;
}

export interface HookIdeaBundle {
  hooks: string[];
  coverLine?: string;
}

export interface ScenePlan extends ApprovedStoryboardSceneMetadata {
  sceneNumber: number;
  visualDescription: string;
  imagePrompt: string;
  estimatedDuration: number;
  scriptGuidance: string;
  /** Optional distinct on-screen caption; falls back to scriptGuidance when omitted. */
  onScreenText?: string;
  userProvidedImage?: UploadedMedia;
  brandImageIndex?: number;
  suggestedAssetIndex?: number;
  brandAssetEditAction?: 'edit' | 'use_as_is';
}

export interface ReelPlan {
  topic: string;
  vibe: string;
  scenes: ScenePlan[];
  brandContext?: string;
  strategicReasoning: string;
}

export interface SessionState {
  id?: string;
  user_id?: string;
  name: string;
  created_at?: string;
  updated_at?: string;
  step: AppStep;
  creationMode: CreationMode;
  topic?: string;
  script?: ReelScript;
  media: Omit<UploadedMedia, 'file'>[];
  visualSettings: VisualSettings;
  subtitleSettings: SubtitleSettings;
  audioMixSettings: AudioMixSettings;
  enableCaptions: boolean;
  enableVoiceover: boolean;
  selectedVoice: VoiceName | string;
  scriptStyle: ScriptStyle;
  brandKit?: BrandKit;
  reelPlan?: ReelPlan;
  sceneDrafts?: SceneDraft[];
  selectedVoiceId?: string;
}

export interface SongAnalysis {
  culturalContext: string;
  mood: string;
  imagery: string;
  characterDescription?: string;
  suggestedVisuals: string[];
  /** Short lyric hooks / chorus lines when vocals are intelligible */
  lyricHooks?: string[];
  /** Song structure notes (intro / verse / chorus / drop) */
  structureNotes?: string;
  segments: {
    startTime: number;
    endTime: number;
    description: string;
    visualPrompt: string;
  }[];
}
