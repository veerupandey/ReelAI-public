/**
 * AI Motion Director — Uses Gemini to analyze scene images and recommend
 * the optimal camera motion (direction, intensity, speed curve) based on
 * composition, subject position, and visual weight.
 *
 * Extended with full viral visual direction: color LUTs, transitions, text
 * animations, motion blur, beat zoom, subject tracking, 3D tilt, chromatic
 * aberration, and auto-generated keyframes — all optimized for viral potential.
 */

import { GoogleGenAI } from "@google/genai";
import { KenBurnsDirection, Keyframe, KeyframeTrack } from "../utils/motionEngine";
import { VisualSettings } from "../types";

export interface MotionRecommendation {
    direction: KenBurnsDirection;
    intensity: number; // 0-1
    reasoning: string;
}

export interface ViralVisualDirection {
    // Per-scene recommendations
    direction: KenBurnsDirection;
    intensity: number;
    colorLUT: VisualSettings['colorLUT'];
    transitionEffect: VisualSettings['transitionEffect'];
    textAnimation: VisualSettings['textAnimation'];
    motionBlur: number;
    chromaticAberration: number;
    perspectiveTilt: number;
    enableSubjectTracking: boolean;
    enableBeatZoom: boolean;
    keyframes?: KeyframeTrack[];
    reasoning: string;
}

export interface FullVisualDirectionResult {
    scenes: ViralVisualDirection[];
    // Global settings applied across all scenes
    globalSettings: Partial<VisualSettings>;
    reasoning: string;
}

interface SceneAnalysisInput {
    imageBase64: string;
    sceneDescription: string;
    sceneIndex: number;
    totalScenes: number;
}

const DIRECTIONS: KenBurnsDirection[] = [
    'zoom-in', 'zoom-out', 'pan-left', 'pan-right', 'pan-up', 'pan-down',
    'zoom-pan-tl', 'zoom-pan-br', 'zoom-pan-tr', 'zoom-pan-bl', 'breathing',
];

const LUT_OPTIONS = ['none', 'teal-orange', 'vintage', 'noir', 'golden-hour', 'matrix-green', 'cyberpunk', 'film-stock'] as const;
const TRANSITION_OPTIONS = ['fade', 'slide', 'zoom', 'none', 'zoom-blur', 'glitch', 'chromatic'] as const;
const TEXT_ANIM_OPTIONS = ['none', 'typewriter', 'bounce-in', 'karaoke-sweep', 'wave', 'glitch-in', 'fade-up'] as const;

/**
 * Analyze a scene image with Gemini and recommend the best camera motion.
 * Falls back to deterministic heuristic if Gemini is unavailable.
 */
export const recommendMotion = async (
    input: SceneAnalysisInput,
): Promise<MotionRecommendation> => {
    try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });
        const prompt = `You are a professional cinematographer and motion director for social media ads.

Analyze this scene image and recommend the BEST camera motion for a 9:16 vertical video.

Scene ${input.sceneIndex + 1} of ${input.totalScenes}.
Scene description: ${input.sceneDescription || 'N/A'}

Consider:
- Subject position (center, left, right, top, bottom)
- Visual weight and composition (rule of thirds, symmetry, leading lines)
- Depth cues (foreground/background separation)
- Emotional tone (energetic = fast zoom, calm = slow pan, intimate = breathing)
- Narrative flow (opening scene = hook with zoom-in, closing = pull back)

Search the web if needed for current best practices in social media ad motion design.

Respond with ONLY a JSON object:
{
  "direction": "zoom-in" | "zoom-out" | "pan-left" | "pan-right" | "pan-up" | "pan-down" | "zoom-pan-tl" | "zoom-pan-br" | "zoom-pan-tr" | "zoom-pan-bl" | "breathing",
  "intensity": 0.0-1.0,
  "reasoning": "one sentence explanation"
}`;

        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: {
                parts: [
                    { inlineData: { data: input.imageBase64, mimeType: 'image/jpeg' } },
                    { text: prompt },
                ],
            },
            config: {
                tools: [{ googleSearch: {} }],
            } as any,
        });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const direction = DIRECTIONS.includes(parsed.direction)
                ? parsed.direction as KenBurnsDirection
                : 'zoom-in';
            return {
                direction,
                intensity: Math.max(0, Math.min(1, parsed.intensity ?? 0.5)),
                reasoning: parsed.reasoning || 'AI-directed motion',
            };
        }
    } catch (e) {
        // Fall through to heuristic
    }

    return heuristicRecommendation(input.sceneIndex, input.totalScenes);
};

/**
 * Deterministic fallback: picks motion based on scene position in the timeline.
 * Opening scenes get zoom-in (hook), middle scenes get variety, closing gets pull-back.
 */
const heuristicRecommendation = (sceneIndex: number, totalScenes: number): MotionRecommendation => {
    const position = sceneIndex / Math.max(1, totalScenes - 1);

    if (position < 0.2) {
        // Opening: hook with zoom-in
        return { direction: 'zoom-in', intensity: 0.6, reasoning: 'Opening hook — zoom in to grab attention' };
    } else if (position > 0.8) {
        // Closing: pull back
        return { direction: 'zoom-out', intensity: 0.4, reasoning: 'Closing — pull back for context' };
    } else {
        // Middle: variety based on scene index
        const midDirections: KenBurnsDirection[] = ['pan-right', 'pan-left', 'zoom-pan-br', 'zoom-pan-tl', 'pan-up'];
        const dir = midDirections[sceneIndex % midDirections.length];
        return { direction: dir, intensity: 0.5, reasoning: 'Mid-scene variety pan' };
    }
};

/**
 * Batch-analyze all scenes and return per-scene motion recommendations.
 */
export const recommendMotionBatch = async (
    scenes: SceneAnalysisInput[],
): Promise<MotionRecommendation[]> => {
    // Process in parallel for speed
    return Promise.all(scenes.map(s => recommendMotion(s)));
};

// ─── Full Viral Visual Direction ─────────────────────────────────────

/**
 * Analyze all scenes with Gemini and recommend the complete visual package:
 * motion, color LUT, transitions, text animation, motion blur, beat zoom,
 * subject tracking, 3D tilt, chromatic aberration, and auto-keyframes.
 *
 * Falls back to deterministic heuristic if Gemini is unavailable.
 */
export const recommendFullVisualDirection = async (
    scenes: SceneAnalysisInput[],
): Promise<FullVisualDirectionResult> => {
    try {
        const ai = new GoogleGenAI({ apiKey: import.meta.env.VITE_API_KEY || '' });

        // Build a combined prompt analyzing all scenes at once for coherence
        const sceneDescriptions = scenes.map((s, i) =>
            `Scene ${i + 1}: ${s.sceneDescription || 'N/A'}`
        ).join('\n');

        const maxImages = Math.min(4, scenes.length);
        const prompt = `You are a viral video motion director and colorist for social media ads (TikTok/Reels/Shorts).

Analyze these ${scenes.length} scenes and recommend the COMPLETE visual direction that maximizes viral potential.
${maxImages > 0 ? `The first ${maxImages} scene images are attached for visual analysis.` : ''}

Scenes:
${sceneDescriptions}

For EACH scene, recommend:
1. Camera motion direction (zoom-in, pan-right, etc.)
2. Motion intensity (0-1)
3. Color LUT (none, teal-orange, vintage, noir, golden-hour, matrix-green, cyberpunk, film-stock)
4. Transition to NEXT scene (fade, slide, zoom, none, zoom-blur, glitch, chromatic)
5. Text animation preset (none, typewriter, bounce-in, karaoke-sweep, wave, glitch-in, fade-up)
6. Motion blur amount (0-1, higher for fast camera moves)
7. Chromatic aberration (0-1, subtle edge RGB split)
8. 3D perspective tilt (0-1, subtle dimensional tilt)
9. Subject tracking (true/false — track subject during zoom)
10. Beat zoom (true/false — audio-reactive zoom pulse)
11. Keyframe pattern (scale_start, scale_end, pan_start, pan_end for dramatic camera moves)

Viral principles:
- Opening scene: aggressive zoom-in + bounce-in text + glitch transition → HOOK
- Product reveal scenes: subject tracking + slow zoom + teal-orange LUT
- Energy/beat scenes: beat zoom + chromatic aberration + motion blur
- Emotional scenes: breathing motion + golden-hour LUT + fade-up text
- Closing scene: zoom-out + fade transition + film-stock LUT
- Vary transitions between scenes — never repeat the same transition twice in a row
- Text animation should match scene energy: energetic=bounce-in/glitch-in, calm=fade-up/typewriter

Respond with ONLY a JSON object:
{
  "scenes": [
    {
      "direction": "zoom-in",
      "intensity": 0.7,
      "colorLUT": "teal-orange",
      "transitionEffect": "glitch",
      "textAnimation": "bounce-in",
      "motionBlur": 0.3,
      "chromaticAberration": 0.15,
      "perspectiveTilt": 0.1,
      "enableSubjectTracking": true,
      "enableBeatZoom": false,
      "keyframes": {
        "scale": [1.0, 1.4],
        "panX": [0, -30],
        "panY": [0, 0]
      },
      "reasoning": "Opening hook — aggressive zoom with glitch transition"
    }
  ],
  "globalSettings": {
    "enableParallax": true,
    "enableParticles": true,
    "enableLightLeaks": true,
    "grain": 0.05,
    "vignette": 0.3
  },
  "reasoning": "Overall viral strategy summary"
}`;

        // Send up to 4 scene images for visual context (Gemini supports multi-image)
        const parts: any[] = [
            { text: prompt },
        ];
        for (let i = 0; i < maxImages; i++) {
            if (scenes[i].imageBase64) {
                parts.unshift({
                    inlineData: { data: scenes[i].imageBase64, mimeType: 'image/jpeg' },
                });
            }
        }

        const response = await ai.models.generateContent({
            model: 'gemini-3.8-flash',
            contents: { parts },
            config: {
                tools: [{ googleSearch: {} }],
            } as any,
        });

        const text = response.text || '';
        const jsonMatch = text.match(/\{[\s\S]*\}/);
        if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            const sceneDirs: ViralVisualDirection[] = (parsed.scenes || []).map((s: any, i: number) => {
                const direction = DIRECTIONS.includes(s.direction)
                    ? s.direction as KenBurnsDirection
                    : 'zoom-in';

                const lut = LUT_OPTIONS.includes(s.colorLUT)
                    ? s.colorLUT as ViralVisualDirection['colorLUT']
                    : 'none';

                const transition = TRANSITION_OPTIONS.includes(s.transitionEffect)
                    ? s.transitionEffect as ViralVisualDirection['transitionEffect']
                    : 'fade';

                const textAnim = TEXT_ANIM_OPTIONS.includes(s.textAnimation)
                    ? s.textAnimation as ViralVisualDirection['textAnimation']
                    : 'none';

                // Generate keyframe tracks from AI recommendation
                const keyframes = generateKeyframesFromAI(s.keyframes, s.direction, s.intensity, i, scenes.length);

                return {
                    direction,
                    intensity: clamp(s.intensity ?? 0.5),
                    colorLUT: lut,
                    transitionEffect: transition,
                    textAnimation: textAnim,
                    motionBlur: clamp(s.motionBlur ?? 0),
                    chromaticAberration: clamp(s.chromaticAberration ?? 0),
                    perspectiveTilt: clamp(s.perspectiveTilt ?? 0),
                    enableSubjectTracking: Boolean(s.enableSubjectTracking),
                    enableBeatZoom: Boolean(s.enableBeatZoom),
                    keyframes,
                    reasoning: s.reasoning || 'AI-directed',
                };
            });

            if (sceneDirs.length > 0) {
                return {
                    scenes: sceneDirs,
                    globalSettings: parsed.globalSettings || {},
                    reasoning: parsed.reasoning || 'AI-optimized viral direction',
                };
            }
        }
    } catch (e) {
        // Fall through to heuristic
    }

    return heuristicFullDirection(scenes);
};

/**
 * Generate KeyframeTrack[] from AI keyframe recommendation or direction-based heuristic.
 */
function generateKeyframesFromAI(
    kfData: any,
    direction: KenBurnsDirection,
    intensity: number,
    sceneIndex: number,
    totalScenes: number,
): KeyframeTrack[] | undefined {
    const tracks: KeyframeTrack[] = [];
    const i = clamp(intensity);

    // If AI provided explicit keyframe values, use them (clamped to safe ranges)
    if (kfData && (kfData.scale || kfData.panX || kfData.panY)) {
        const clampScale = (v: number) => Math.max(0.5, Math.min(3, Number(v) || 1));
        const clampPan = (v: number) => Math.max(-1, Math.min(1, Number(v) || 0));
        if (kfData.scale && Array.isArray(kfData.scale) && kfData.scale.length === 2) {
            tracks.push({
                property: 'scale',
                keyframes: [
                    { time: 0, value: clampScale(kfData.scale[0]), easing: 'ease-in-out' },
                    { time: 1, value: clampScale(kfData.scale[1]), easing: 'ease-in-out' },
                ],
            });
        }
        if (kfData.panX && Array.isArray(kfData.panX) && kfData.panX.length === 2) {
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: clampPan(kfData.panX[0]), easing: 'ease-in-out' },
                    { time: 1, value: clampPan(kfData.panX[1]), easing: 'ease-in-out' },
                ],
            });
        }
        if (kfData.panY && Array.isArray(kfData.panY) && kfData.panY.length === 2) {
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: clampPan(kfData.panY[0]), easing: 'ease-in-out' },
                    { time: 1, value: clampPan(kfData.panY[1]), easing: 'ease-in-out' },
                ],
            });
        }
        return tracks.length >= 2 ? tracks : undefined;
    }

    // Otherwise generate from direction + intensity
    return generateKeyframesForDirection(direction, i, sceneIndex, totalScenes);
}

/**
 * Generate cinematic keyframe tracks based on camera direction and intensity.
 * Creates 3-point keyframe patterns: start → peak → end for dynamic motion.
 */
function generateKeyframesForDirection(
    direction: KenBurnsDirection,
    intensity: number,
    sceneIndex: number,
    totalScenes: number,
): KeyframeTrack[] | undefined {
    const i = Math.max(0.1, intensity);
    const isOpening = sceneIndex === 0;
    const isClosing = sceneIndex === totalScenes - 1;

    const EASE: Keyframe['easing'] = 'ease-in-out';
    const tracks: KeyframeTrack[] = [];

    // Scale track — varies by direction
    switch (direction) {
        case 'zoom-in':
            tracks.push({
                property: 'scale',
                keyframes: [
                    { time: 0, value: 1.0, easing: 'ease-out' },
                    { time: 0.4, value: 1.0 + i * 0.3, easing: 'ease-in-out' },
                    { time: 1, value: 1.0 + i * 0.6, easing: 'ease-in' },
                ],
            });
            break;
        case 'zoom-out':
            tracks.push({
                property: 'scale',
                keyframes: [
                    { time: 0, value: 1.0 + i * 0.5, easing: 'ease-out' },
                    { time: 0.5, value: 1.0 + i * 0.2, easing: 'ease-in-out' },
                    { time: 1, value: 1.0, easing: 'ease-in' },
                ],
            });
            break;
        case 'breathing':
            tracks.push({
                property: 'scale',
                keyframes: [
                    { time: 0, value: 1.0, easing: EASE },
                    { time: 0.5, value: 1.0 + i * 0.08, easing: EASE },
                    { time: 1, value: 1.0, easing: EASE },
                ],
            });
            break;
        default:
            // Pan directions — subtle scale
            tracks.push({
                property: 'scale',
                keyframes: [
                    { time: 0, value: 1.0 + i * 0.1, easing: EASE },
                    { time: 1, value: 1.0 + i * 0.15, easing: EASE },
                ],
            });
    }

    // Pan tracks — based on direction
    const panAmount = 80 * i;
    switch (direction) {
        case 'pan-left':
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: panAmount, easing: EASE },
                    { time: 1, value: -panAmount, easing: EASE },
                ],
            });
            break;
        case 'pan-right':
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: -panAmount, easing: EASE },
                    { time: 1, value: panAmount, easing: EASE },
                ],
            });
            break;
        case 'pan-up':
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: panAmount * 0.5, easing: EASE },
                    { time: 1, value: -panAmount * 0.5, easing: EASE },
                ],
            });
            break;
        case 'pan-down':
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: -panAmount * 0.5, easing: EASE },
                    { time: 1, value: panAmount * 0.5, easing: EASE },
                ],
            });
            break;
        case 'zoom-pan-tl':
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: panAmount * 0.3, easing: EASE },
                    { time: 1, value: -panAmount * 0.3, easing: EASE },
                ],
            });
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: panAmount * 0.3, easing: EASE },
                    { time: 1, value: -panAmount * 0.3, easing: EASE },
                ],
            });
            break;
        case 'zoom-pan-br':
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: -panAmount * 0.3, easing: EASE },
                    { time: 1, value: panAmount * 0.3, easing: EASE },
                ],
            });
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: -panAmount * 0.3, easing: EASE },
                    { time: 1, value: panAmount * 0.3, easing: EASE },
                ],
            });
            break;
        case 'zoom-pan-tr':
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: -panAmount * 0.3, easing: EASE },
                    { time: 1, value: panAmount * 0.3, easing: EASE },
                ],
            });
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: panAmount * 0.3, easing: EASE },
                    { time: 1, value: -panAmount * 0.3, easing: EASE },
                ],
            });
            break;
        case 'zoom-pan-bl':
            tracks.push({
                property: 'panX',
                keyframes: [
                    { time: 0, value: panAmount * 0.3, easing: EASE },
                    { time: 1, value: -panAmount * 0.3, easing: EASE },
                ],
            });
            tracks.push({
                property: 'panY',
                keyframes: [
                    { time: 0, value: -panAmount * 0.3, easing: EASE },
                    { time: 1, value: panAmount * 0.3, easing: EASE },
                ],
            });
            break;
    }

    // Opacity track for opening/closing scenes
    if (isOpening) {
        tracks.push({
            property: 'opacity',
            keyframes: [
                { time: 0, value: 0, easing: 'ease-out' },
                { time: 0.15, value: 1, easing: 'ease-out' },
                { time: 1, value: 1, easing: 'linear' },
            ],
        });
    } else if (isClosing) {
        tracks.push({
            property: 'opacity',
            keyframes: [
                { time: 0, value: 1, easing: 'linear' },
                { time: 0.85, value: 1, easing: 'ease-in' },
                { time: 1, value: 0, easing: 'ease-in' },
            ],
        });
    }

    return tracks.length >= 2 ? tracks : undefined;
}

/**
 * Deterministic fallback: generates full viral visual direction based on
 * scene position, variety rules, and viral best practices.
 */
const heuristicFullDirection = (scenes: SceneAnalysisInput[]): FullVisualDirectionResult => {
    const total = scenes.length;
    const sceneDirs: ViralVisualDirection[] = scenes.map((_, idx) => {
        const position = idx / Math.max(1, total - 1);
        const isOpening = position < 0.15;
        const isClosing = position > 0.85;
        const isProductReveal = scenes[idx].sceneDescription?.toLowerCase().includes('product') ||
                                scenes[idx].sceneDescription?.toLowerCase().includes('reveal');

        // Direction
        let direction: KenBurnsDirection;
        let intensity: number;
        if (isOpening) {
            direction = 'zoom-in';
            intensity = 0.7;
        } else if (isClosing) {
            direction = 'zoom-out';
            intensity = 0.4;
        } else if (isProductReveal) {
            direction = 'zoom-in';
            intensity = 0.5;
        } else {
            const midDirs: KenBurnsDirection[] = ['pan-right', 'pan-left', 'zoom-pan-br', 'zoom-pan-tl', 'pan-up', 'breathing'];
            direction = midDirs[idx % midDirs.length];
            intensity = 0.45 + (idx % 3) * 0.1;
        }

        // Color LUT — vary by scene mood
        const luts: ViralVisualDirection['colorLUT'][] = ['teal-orange', 'golden-hour', 'film-stock', 'teal-orange', 'vintage'];
        const colorLUT = isOpening ? 'teal-orange' : isClosing ? 'film-stock' : luts[idx % luts.length];

        // Transition — never repeat same transition twice
        const transitions: ViralVisualDirection['transitionEffect'][] = ['glitch', 'zoom-blur', 'chromatic', 'slide', 'zoom', 'fade'];
        const transitionEffect = isClosing ? 'fade' : transitions[idx % transitions.length];

        // Text animation — match energy
        let textAnimation: ViralVisualDirection['textAnimation'];
        if (isOpening) {
            textAnimation = 'bounce-in';
        } else if (isClosing) {
            textAnimation = 'fade-up';
        } else if (intensity > 0.6) {
            textAnimation = idx % 2 === 0 ? 'glitch-in' : 'karaoke-sweep';
        } else {
            textAnimation = idx % 2 === 0 ? 'typewriter' : 'fade-up';
        }

        // Advanced effects
        const motionBlur = intensity > 0.6 ? 0.3 : 0.1;
        const chromaticAberration = isOpening ? 0.2 : (idx % 3 === 0 ? 0.1 : 0.05);
        const perspectiveTilt = idx % 2 === 0 ? 0.08 : 0.04;
        const enableSubjectTracking = isProductReveal || direction === 'zoom-in';
        const enableBeatZoom = !isOpening && !isClosing && idx % 2 === 1;

        // Auto-generate keyframes
        const keyframes = generateKeyframesForDirection(direction, intensity, idx, total);

        return {
            direction,
            intensity,
            colorLUT,
            transitionEffect,
            textAnimation,
            motionBlur,
            chromaticAberration,
            perspectiveTilt,
            enableSubjectTracking,
            enableBeatZoom,
            keyframes,
            reasoning: isOpening ? 'Opening hook — aggressive zoom + glitch transition + bounce-in text'
                : isClosing ? 'Closing — pull back + fade + film-stock LUT'
                : isProductReveal ? 'Product reveal — subject tracking + slow zoom + teal-orange'
                : 'Mid-scene variety — alternating motion and text patterns',
        };
    });

    return {
        scenes: sceneDirs,
        globalSettings: {
            enableParallax: true,
            enableParticles: true,
            enableLightLeaks: true,
            grain: 0.05,
            vignette: 0.3,
            contrast: 1.1,
            saturation: 1.15,
        },
        reasoning: 'Heuristic viral strategy: aggressive opening, product-tracking reveals, varied mid-scenes, gentle closing',
    };
};

/**
 * Convert a FullVisualDirectionResult into VisualSettings + sceneKeyframes
 * that can be directly applied to the app state.
 */
export const applyVisualDirection = (
    result: FullVisualDirectionResult,
    currentSettings: VisualSettings,
): { visualSettings: VisualSettings; sceneKeyframes: { [sceneIndex: number]: KeyframeTrack[] } } => {
    // Use first scene's direction as the global motion direction
    // (individual scenes override via perSceneOverrides + keyframes)
    const firstScene = result.scenes[0];

    // Build per-scene overrides — each scene gets its own LUT, transition, text animation, etc.
    const perSceneOverrides: { [sceneIndex: number]: import('../types').SceneVisualOverride } = {};
    result.scenes.forEach((scene, idx) => {
        perSceneOverrides[idx] = {
            colorLUT: scene.colorLUT,
            transitionEffect: scene.transitionEffect,
            textAnimation: scene.textAnimation,
            motionBlur: scene.motionBlur,
            chromaticAberration: scene.chromaticAberration,
            perspectiveTilt: scene.perspectiveTilt,
            enableSubjectTracking: scene.enableSubjectTracking,
            enableBeatZoom: scene.enableBeatZoom,
            motionDirection: scene.direction,
            motionIntensity: scene.intensity,
        };
    });

    const visualSettings: VisualSettings = {
        ...currentSettings,
        ...result.globalSettings,
        // Global defaults (first scene) — perSceneOverrides take precedence in ReelPreview
        motionDirection: firstScene?.direction || 'zoom-in',
        motionIntensity: firstScene?.intensity || 0.5,
        colorLUT: firstScene?.colorLUT || 'none',
        transitionEffect: firstScene?.transitionEffect || 'fade',
        textAnimation: firstScene?.textAnimation || 'none',
        motionBlur: firstScene?.motionBlur || 0,
        chromaticAberration: firstScene?.chromaticAberration || 0,
        perspectiveTilt: firstScene?.perspectiveTilt || 0,
        enableSubjectTracking: firstScene?.enableSubjectTracking ?? false,
        enableBeatZoom: firstScene?.enableBeatZoom ?? false,
        perSceneOverrides,
    };

    // Build per-scene keyframes
    const sceneKeyframes: { [sceneIndex: number]: KeyframeTrack[] } = {};
    result.scenes.forEach((scene, idx) => {
        if (scene.keyframes && scene.keyframes.length >= 2) {
            sceneKeyframes[idx] = scene.keyframes;
        }
    });

    return { visualSettings, sceneKeyframes };
};

// ─── Helpers ─────────────────────────────────────────────────────────

function clamp(v: number, min: number = 0, max: number = 1): number {
    return Math.max(min, Math.min(max, v));
}

// ─── Viral Score ─────────────────────────────────────────────────────

export interface ViralScoreBreakdown {
    total: number;
    variety: number;
    energy: number;
    pacing: number;
    polish: number;
    suggestions: string[];
}

/**
 * Compute a viral potential score (0-100) from visual settings.
 * Scores based on: variety (different settings per scene), energy (motion intensity),
 * pacing (transition variety + beat sync), and polish (LUTs, effects, text animation).
 */
export const computeViralScore = (
    settings: VisualSettings,
    sceneCount: number,
): ViralScoreBreakdown => {
    const suggestions: string[] = [];
    const overrides = settings.perSceneOverrides || {};
    const hasPerScene = Object.keys(overrides).length > 0;

    // ── Variety (0-25): Are scenes visually different? ──
    let variety = 0;
    if (hasPerScene && sceneCount > 1) {
        const luts = new Set<string>();
        const transitions = new Set<string>();
        const textAnims = new Set<string>();
        const directions = new Set<string>();

        Object.values(overrides).forEach((s: any) => {
            if (s.colorLUT) luts.add(s.colorLUT);
            if (s.transitionEffect) transitions.add(s.transitionEffect);
            if (s.textAnimation) textAnims.add(s.textAnimation);
            if (s.motionDirection) directions.add(s.motionDirection);
        });

        // Score based on unique values relative to scene count
        const lutVariety = Math.min(1, luts.size / Math.max(2, sceneCount * 0.4));
        const transVariety = Math.min(1, transitions.size / Math.max(2, sceneCount * 0.4));
        const textVariety = Math.min(1, textAnims.size / Math.max(2, sceneCount * 0.3));
        const dirVariety = Math.min(1, directions.size / Math.max(2, sceneCount * 0.4));

        variety = Math.round((lutVariety + transVariety + textVariety + dirVariety) / 4 * 25);
    } else {
        variety = 5; // No per-scene overrides = low variety
        suggestions.push('Use AI Auto-Direct to give each scene unique visual style');
    }

    // ── Energy (0-25): Motion intensity and dynamic effects ──
    let energy = 0;
    const avgIntensity = hasPerScene
        ? Object.values(overrides).reduce((sum: number, s: any) => sum + (s.motionIntensity || 0), 0) / Math.max(1, Object.keys(overrides).length)
        : settings.motionIntensity || 0;

    energy += Math.round(avgIntensity * 10); // 0-10 from intensity

    if (settings.enableBeatZoom || Object.values(overrides).some((s: any) => s.enableBeatZoom)) {
        energy += 5;
    } else if (sceneCount > 2) {
        suggestions.push('Enable Beat Zoom for audio-reactive energy');
    }

    if (settings.motionBlur || Object.values(overrides).some((s: any) => (s.motionBlur || 0) > 0)) {
        energy += 3;
    }
    if (settings.chromaticAberration || Object.values(overrides).some((s: any) => (s.chromaticAberration || 0) > 0)) {
        energy += 3;
    }
    if (settings.perspectiveTilt || Object.values(overrides).some((s: any) => (s.perspectiveTilt || 0) > 0)) {
        energy += 2;
    }
    if (settings.enableSubjectTracking || Object.values(overrides).some((s: any) => s.enableSubjectTracking)) {
        energy += 2;
    }

    energy = Math.min(25, energy);

    // ── Pacing (0-25): Transition variety and opening/closing structure ──
    let pacing = 0;
    const allTransitions = hasPerScene
        ? Object.values(overrides).map((s: any) => s.transitionEffect).filter(Boolean)
        : [settings.transitionEffect];

    const uniqueTransitions = new Set(allTransitions).size;
    pacing += Math.min(8, uniqueTransitions * 2);

    // Check for opening hook (zoom-in on first scene)
    const firstOverride = overrides[0];
    const firstDirection = firstOverride?.motionDirection ?? settings.motionDirection;
    if (firstDirection === 'zoom-in' || firstDirection === 'zoom-pan-tl' || firstDirection === 'zoom-pan-br') {
        pacing += 5;
    } else {
        suggestions.push('Start with a zoom-in motion for a strong opening hook');
    }

    // Check for closing fade
    const lastOverride = overrides[sceneCount - 1];
    const lastTransition = lastOverride?.transitionEffect ?? settings.transitionEffect;
    if (lastTransition === 'fade' || lastTransition === 'zoom-blur') {
        pacing += 4;
    }

    // Beat sync
    if (settings.enableBeatZoom) {
        pacing += 8;
    } else if (sceneCount > 2) {
        suggestions.push('Enable Beat Zoom to sync transitions to beat drops');
    }

    pacing = Math.min(25, pacing);

    // ── Polish (0-25): LUTs, text animation, particles, parallax ──
    let polish = 0;

    const hasLUT = settings.colorLUT !== 'none' && settings.colorLUT !== undefined
        || Object.values(overrides).some((s: any) => s.colorLUT && s.colorLUT !== 'none');
    if (hasLUT) polish += 6;
    else suggestions.push('Apply a Color LUT for professional grading');

    const hasTextAnim = settings.textAnimation !== 'none' && settings.textAnimation !== undefined
        || Object.values(overrides).some((s: any) => s.textAnimation && s.textAnimation !== 'none');
    if (hasTextAnim) polish += 5;
    else suggestions.push('Add text animation presets for dynamic captions');

    if (settings.enableParallax !== false) polish += 4;
    if (settings.enableParticles) polish += 3;
    if (settings.enableLightLeaks) polish += 3;
    if ((settings.grain || 0) > 0) polish += 2;
    if ((settings.vignette || 0) > 0) polish += 2;

    polish = Math.min(25, polish);

    const total = variety + energy + pacing + polish;

    return { total, variety, energy, pacing, polish, suggestions };
};
