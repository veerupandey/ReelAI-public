import { describe, it, expect } from 'vitest';
import {
    evaluateKeyframeTrack,
    KeyframeTrack,
    computeTextAnimation,
    detectBeats,
    getBeatIntensity,
    computeSubjectTracking,
    SegmentationMask,
    drawMotionBlur,
    drawZoomBlur,
    drawGlitchEffect,
    getLUTFilter,
    applyPerspectiveTilt,
    computeCameraShake,
    SpringSystem,
    detectBPM,
    findNearestBeat,
    snapBoundariesToBeats,
} from '../utils/motionEngine';
import { computeViralScore } from '../services/motionDirectorService';
import type { VisualSettings } from '../types';

// ─── Keyframe System Tests ───────────────────────────────────────────

describe('evaluateKeyframeTrack', () => {
    it('returns single keyframe value when only one keyframe', () => {
        const track: KeyframeTrack = {
            property: 'scale',
            keyframes: [{ time: 0, value: 2, easing: 'linear' }],
        };
        expect(evaluateKeyframeTrack(track, 0)).toBe(2);
        expect(evaluateKeyframeTrack(track, 0.5)).toBe(2);
        expect(evaluateKeyframeTrack(track, 1)).toBe(2);
    });

    it('returns 0 for empty track', () => {
        const track: KeyframeTrack = { property: 'scale', keyframes: [] };
        expect(evaluateKeyframeTrack(track, 0.5)).toBe(0);
    });

    it('linearly interpolates between two keyframes', () => {
        const track: KeyframeTrack = {
            property: 'panX',
            keyframes: [
                { time: 0, value: 0, easing: 'linear' },
                { time: 1, value: 100, easing: 'linear' },
            ],
        };
        expect(evaluateKeyframeTrack(track, 0)).toBe(0);
        expect(evaluateKeyframeTrack(track, 0.5)).toBe(50);
        expect(evaluateKeyframeTrack(track, 1)).toBe(100);
    });

    it('clamps before first and after last keyframe', () => {
        const track: KeyframeTrack = {
            property: 'scale',
            keyframes: [
                { time: 0.2, value: 1, easing: 'linear' },
                { time: 0.8, value: 3, easing: 'linear' },
            ],
        };
        expect(evaluateKeyframeTrack(track, 0)).toBe(1);
        expect(evaluateKeyframeTrack(track, 1)).toBe(3);
    });

    it('applies ease-in easing', () => {
        const track: KeyframeTrack = {
            property: 'scale',
            keyframes: [
                { time: 0, value: 0, easing: 'ease-in' },
                { time: 1, value: 100, easing: 'ease-in' },
            ],
        };
        // At t=0.5, ease-in gives 0.25 (quadratic), so value = 25
        expect(evaluateKeyframeTrack(track, 0.5)).toBe(25);
    });

    it('applies ease-out easing', () => {
        const track: KeyframeTrack = {
            property: 'scale',
            keyframes: [
                { time: 0, value: 0, easing: 'ease-out' },
                { time: 1, value: 100, easing: 'ease-out' },
            ],
        };
        // At t=0.5, ease-out gives 0.75, so value = 75
        expect(evaluateKeyframeTrack(track, 0.5)).toBe(75);
    });

    it('applies ease-in-out easing', () => {
        const track: KeyframeTrack = {
            property: 'opacity',
            keyframes: [
                { time: 0, value: 0, easing: 'ease-in-out' },
                { time: 1, value: 1, easing: 'ease-in-out' },
            ],
        };
        // At t=0.5, ease-in-out gives 0.5
        expect(evaluateKeyframeTrack(track, 0.5)).toBeCloseTo(0.5, 5);
    });

    it('interpolates across 3 keyframes', () => {
        const track: KeyframeTrack = {
            property: 'scale',
            keyframes: [
                { time: 0, value: 1, easing: 'linear' },
                { time: 0.5, value: 2, easing: 'linear' },
                { time: 1, value: 1, easing: 'linear' },
            ],
        };
        expect(evaluateKeyframeTrack(track, 0)).toBe(1);
        expect(evaluateKeyframeTrack(track, 0.25)).toBe(1.5);
        expect(evaluateKeyframeTrack(track, 0.5)).toBe(2);
        expect(evaluateKeyframeTrack(track, 0.75)).toBe(1.5);
        expect(evaluateKeyframeTrack(track, 1)).toBe(1);
    });

    it('applies bezier easing', () => {
        const track: KeyframeTrack = {
            property: 'scale',
            keyframes: [
                { time: 0, value: 0, easing: 'bezier', bezierCP: [0.42, 0, 0.58, 1] },
                { time: 1, value: 100, easing: 'bezier' },
            ],
        };
        // Bezier (0.42, 0, 0.58, 1) is close to ease-in-out
        const midVal = evaluateKeyframeTrack(track, 0.5);
        expect(midVal).toBeGreaterThan(30);
        expect(midVal).toBeLessThan(70);
    });
});

// ─── Text Animation Tests ────────────────────────────────────────────

describe('computeTextAnimation', () => {
    it('typewriter reveals characters progressively', () => {
        const state = computeTextAnimation('typewriter', 0, 10);
        expect(state.visibleChars).toBe(0);
        const state2 = computeTextAnimation('typewriter', 0.5, 10);
        expect(state2.visibleChars).toBe(25); // 0.5 * 10 * 5
        const state3 = computeTextAnimation('typewriter', 1, 10);
        expect(state3.visibleChars).toBe(50);
    });

    it('bounce-in overshoots then settles', () => {
        const early = computeTextAnimation('bounce-in', 0.2, 5);
        const mid = computeTextAnimation('bounce-in', 0.55, 5);
        const late = computeTextAnimation('bounce-in', 1, 5);
        // Early: offsetY should be positive (text below final position)
        expect(early.offsetY).toBeGreaterThan(0);
        // Mid: should be overshooting (bounce > 1 → negative offset)
        expect(mid.offsetY).toBeLessThan(0);
        // Late: settled at 0
        expect(late.offsetY).toBeCloseTo(0, 5);
    });

    it('karaoke-sweep sets highlightProgress', () => {
        const state = computeTextAnimation('karaoke-sweep', 0.5, 5);
        expect(state.highlightProgress).toBe(0.5);
    });

    it('wave generates per-word offsets', () => {
        const state = computeTextAnimation('wave', 0.5, 4);
        expect(state.waveOffsets.length).toBe(4);
        state.waveOffsets.forEach(offset => {
            expect(Math.abs(offset)).toBeLessThanOrEqual(8);
        });
    });

    it('glitch-in decays offset over time', () => {
        const early = computeTextAnimation('glitch-in', 0.1, 5);
        const late = computeTextAnimation('glitch-in', 0.9, 5);
        expect(early.glitchOffset).toBeGreaterThan(0);
        expect(late.glitchOffset).toBe(0);
    });

    it('fade-up transitions opacity and offset', () => {
        const start = computeTextAnimation('fade-up', 0, 5);
        const end = computeTextAnimation('fade-up', 1, 5);
        expect(start.opacity).toBe(0);
        expect(start.offsetY).toBe(20);
        expect(end.opacity).toBe(1);
        expect(end.offsetY).toBe(0);
    });

    it('none preset returns full visibility', () => {
        const state = computeTextAnimation('none', 0.5, 5);
        expect(state.opacity).toBe(1);
        expect(state.offsetY).toBe(0);
        expect(state.glitchOffset).toBe(0);
    });
});

// ─── Beat Detection Tests ────────────────────────────────────────────

describe('detectBeats', () => {
    function makeAudioBuffer(sampleRate: number, duration: number, samples: Float32Array): AudioBuffer {
        return {
            sampleRate,
            length: samples.length,
            duration,
            numberOfChannels: 1,
            getChannelData: () => samples,
            copyFromChannel: () => {},
            copyToChannel: () => {},
        } as unknown as AudioBuffer;
    }

    it('detects beats in audio with energy spikes', () => {
        const sampleRate = 8000;
        const duration = 2; // 2 seconds
        const numSamples = sampleRate * duration;
        const samples = new Float32Array(numSamples);

        // Background noise
        for (let i = 0; i < numSamples; i++) {
            samples[i] = (Math.random() - 0.5) * 0.1;
        }

        // Add strong energy spikes every 0.5 seconds (120 BPM)
        for (let beat = 0; beat < 4; beat++) {
            const beatSample = Math.floor(beat * 0.5 * sampleRate);
            for (let i = 0; i < 200; i++) {
                samples[beatSample + i] = 0.95 * Math.sin(i * 0.3);
            }
        }

        const buffer = makeAudioBuffer(sampleRate, duration, samples);
        const beats = detectBeats(buffer);
        expect(beats.length).toBeGreaterThan(0);
        // First detected beat should be after the first local window (~1s)
        expect(beats[0]).toBeGreaterThan(0.4);
    });

    it('returns empty for silent audio', () => {
        const sampleRate = 8000;
        const samples = new Float32Array(sampleRate * 1);
        const buffer = makeAudioBuffer(sampleRate, 1, samples);
        const beats = detectBeats(buffer);
        expect(beats.length).toBe(0);
    });
});

describe('getBeatIntensity', () => {
    it('returns 0 when no beat nearby', () => {
        expect(getBeatIntensity([1.0, 2.0], 0.5)).toBe(0);
        expect(getBeatIntensity([1.0, 2.0], 5.0)).toBe(0);
    });

    it('returns peak intensity at beat time', () => {
        const beats = [1.0];
        // At exactly beat time + 0.025 (mid-attack), should be ~0.5
        const intensity = getBeatIntensity(beats, 1.025);
        expect(intensity).toBeGreaterThan(0.4);
        expect(intensity).toBeLessThan(0.6);
    });

    it('returns 1 at peak of attack', () => {
        const beats = [1.0];
        // At dt=0.05, attack is complete → intensity = 1
        const intensity = getBeatIntensity(beats, 1.05);
        expect(intensity).toBeCloseTo(1, 1);
    });

    it('decays after beat', () => {
        const beats = [1.0];
        const peak = getBeatIntensity(beats, 1.05);
        const decayed = getBeatIntensity(beats, 1.2);
        expect(decayed).toBeLessThan(peak);
        expect(decayed).toBeGreaterThan(0);
    });
});

// ─── Subject Tracking Tests ──────────────────────────────────────────

describe('computeSubjectTracking', () => {
    it('returns zero offset when no segmentation', () => {
        const result = computeSubjectTracking(null, 1080, 1920, 2);
        expect(result.offsetX).toBe(0);
        expect(result.offsetY).toBe(0);
    });

    it('returns zero offset when zoom is 1', () => {
        const seg: SegmentationMask = {
            width: 100,
            height: 100,
            mask: new Uint8Array(100),
            bbox: { x: 25, y: 25, w: 50, h: 50 },
        };
        const result = computeSubjectTracking(seg, 1080, 1920, 1);
        expect(result.offsetX).toBe(0);
        expect(result.offsetY).toBe(0);
    });

    it('offsets camera to keep subject centered during zoom', () => {
        // Subject in top-left quadrant
        const seg: SegmentationMask = {
            width: 100,
            height: 100,
            mask: new Uint8Array(100),
            bbox: { x: 0, y: 0, w: 30, h: 30 },
        };
        // Subject center is at (15%, 15%) — top-left
        // With zoom=2, offset should pull camera toward subject
        const result = computeSubjectTracking(seg, 1000, 1000, 2);
        // offsetX = (0.5 - 0.15) * 1000 * (2-1) = 350
        expect(result.offsetX).toBe(350);
        expect(result.offsetY).toBe(350);
    });

    it('returns zero for centered subject', () => {
        const seg: SegmentationMask = {
            width: 100,
            height: 100,
            mask: new Uint8Array(100),
            bbox: { x: 40, y: 40, w: 20, h: 20 },
        };
        // Subject center at (50%, 50%) — perfectly centered
        const result = computeSubjectTracking(seg, 1000, 1000, 3);
        expect(result.offsetX).toBe(0);
        expect(result.offsetY).toBe(0);
    });
});

// ─── Color LUT Tests ─────────────────────────────────────────────────

describe('getLUTFilter', () => {
    it('returns none for none preset', () => {
        expect(getLUTFilter('none')).toBe('none');
    });

    it('returns filter string for teal-orange', () => {
        const filter = getLUTFilter('teal-orange');
        expect(filter).toContain('contrast');
        expect(filter).toContain('saturate');
    });

    it('returns grayscale for noir', () => {
        const filter = getLUTFilter('noir');
        expect(filter).toContain('grayscale');
    });

    it('returns sepia for vintage', () => {
        const filter = getLUTFilter('vintage');
        expect(filter).toContain('sepia');
    });

    it('returns hue-rotate for cyberpunk', () => {
        const filter = getLUTFilter('cyberpunk');
        expect(filter).toContain('hue-rotate');
    });

    it('all LUTs have valid filter strings', () => {
        const luts = ['none', 'teal-orange', 'vintage', 'noir', 'golden-hour', 'matrix-green', 'cyberpunk', 'film-stock'] as const;
        luts.forEach(lut => {
            const filter = getLUTFilter(lut);
            expect(typeof filter).toBe('string');
            expect(filter.length).toBeGreaterThan(0);
        });
    });
});

// ─── Spring Physics Tests ────────────────────────────────────────────

describe('SpringSystem', () => {
    it('initializes at rest', () => {
        const spring = new SpringSystem(); // default stiffness=80, damping=14, mass=1
        const state = spring.update(0.016);
        expect(state.x).toBe(0);
        expect(state.y).toBe(0);
        expect(state.scale).toBe(1);
    });

    it('moves toward target', () => {
        const spring = new SpringSystem();
        spring.setTarget(100, 50, 2);
        // After several updates, should be moving toward target
        let state;
        for (let i = 0; i < 10; i++) {
            state = spring.update(0.016);
        }
        expect(state!.x).toBeGreaterThan(0);
        expect(state!.y).toBeGreaterThan(0);
        expect(state!.scale).toBeGreaterThan(1);
    });

    it('converges to target over time', () => {
        const spring = new SpringSystem();
        spring.setTarget(50, 0, 1.5);
        let state;
        for (let i = 0; i < 300; i++) {
            state = spring.update(0.016);
        }
        expect(state!.x).toBeCloseTo(50, 0);
        expect(state!.scale).toBeCloseTo(1.5, 0);
    });
});

// ─── Camera Shake Tests ──────────────────────────────────────────────

describe('computeCameraShake', () => {
    it('returns zero shake when disabled', () => {
        const shake = computeCameraShake(1000, { enabled: false, intensity: 5, frequency: 2 });
        expect(shake.x).toBe(0);
        expect(shake.y).toBe(0);
        expect(shake.rotation).toBe(0);
    });

    it('produces non-zero shake when enabled', () => {
        const shake = computeCameraShake(1000, { enabled: true, intensity: 5, frequency: 2 });
        // Over multiple time samples, should produce varied values
        const samples = [1000, 1100, 1200, 1300, 1400].map(t =>
            computeCameraShake(t, { enabled: true, intensity: 5, frequency: 2 })
        );
        const hasNonZero = samples.some(s => s.x !== 0 || s.y !== 0);
        expect(hasNonZero).toBe(true);
    });

    it('shake magnitude is bounded by intensity', () => {
        const intensity = 3;
        for (let t = 0; t < 1000; t += 50) {
            const shake = computeCameraShake(t, { enabled: true, intensity, frequency: 2 });
            expect(Math.abs(shake.x)).toBeLessThanOrEqual(intensity);
            expect(Math.abs(shake.y)).toBeLessThanOrEqual(intensity);
        }
    });
});

// ─── Motion Blur / Zoom Blur / Glitch Tests ──────────────────────────

describe('drawMotionBlur', () => {
    it('calls drawFn directly when velocity is zero', () => {
        let callCount = 0;
        const drawFn = () => { callCount++; };
        const ctx = { save: () => {}, restore: () => {}, translate: () => {}, globalAlpha: 1 } as any;
        drawMotionBlur(ctx, drawFn, 0, 0, 0.5);
        expect(callCount).toBe(1);
    });

    it('calls drawFn multiple times when velocity is high', () => {
        let callCount = 0;
        const drawFn = () => { callCount++; };
        const ctx = { save: () => {}, restore: () => {}, translate: () => {}, globalAlpha: 1 } as any;
        drawMotionBlur(ctx, drawFn, 10, 5, 0.8);
        // 5 trailing copies + 1 sharp = 6
        expect(callCount).toBe(6);
    });
});

describe('drawZoomBlur', () => {
    it('calls drawFn once when intensity is zero', () => {
        let callCount = 0;
        const drawFn = () => { callCount++; };
        const ctx = {
            save: () => {}, restore: () => {}, translate: () => {},
            scale: () => {}, globalAlpha: 1,
        } as any;
        drawZoomBlur(ctx, drawFn, 1080, 1920, 0);
        expect(callCount).toBe(1);
    });

    it('calls drawFn multiple times when intensity > 0', () => {
        let callCount = 0;
        const drawFn = () => { callCount++; };
        const ctx = {
            save: () => {}, restore: () => {}, translate: () => {},
            scale: () => {}, globalAlpha: 1,
        } as any;
        drawZoomBlur(ctx, drawFn, 1080, 1920, 0.5);
        // 6 trailing copies + 1 sharp = 7
        expect(callCount).toBe(7);
    });
});

describe('drawGlitchEffect', () => {
    it('draws canvas directly when intensity is zero', () => {
        const drawImageCalls: any[] = [];
        const ctx = {
            drawImage: (...args: any[]) => { drawImageCalls.push(args); },
            save: () => {}, restore: () => {}, filter: '',
            globalAlpha: 1, globalCompositeOperation: '',
        } as any;
        const canvas = {} as HTMLCanvasElement;
        drawGlitchEffect(ctx, canvas, 1080, 1920, 0, 1000);
        expect(drawImageCalls.length).toBe(1);
    });

    it('draws multiple slices when intensity > 0', () => {
        const drawImageCalls: any[] = [];
        const ctx = {
            drawImage: (...args: any[]) => { drawImageCalls.push(args); },
            save: () => {}, restore: () => {}, filter: '',
            globalAlpha: 1, globalCompositeOperation: '',
        } as any;
        const canvas = {} as HTMLCanvasElement;
        drawGlitchEffect(ctx, canvas, 1080, 1920, 0.5, 1000);
        // 12 slices (intensity 0.5 > 0.3, so +2 RGB split = 14)
        expect(drawImageCalls.length).toBe(14);
    });

    it('adds RGB split overlay when intensity > 0.3', () => {
        const drawImageCalls: any[] = [];
        const ctx = {
            drawImage: (...args: any[]) => { drawImageCalls.push(args); },
            save: () => {}, restore: () => {}, filter: '',
            globalAlpha: 1, globalCompositeOperation: '',
        } as any;
        const canvas = {} as HTMLCanvasElement;
        drawGlitchEffect(ctx, canvas, 1080, 1920, 0.6, 1000);
        // 12 slices + 2 RGB split = 14
        expect(drawImageCalls.length).toBe(14);
    });
});

// ─── Perspective Tilt Tests ──────────────────────────────────────────

describe('applyPerspectiveTilt', () => {
    it('applies transform to context', () => {
        let transformCalled = false;
        const transformArgs: any[] = [];
        const ctx = {
            transform: (...args: any[]) => { transformCalled = true; transformArgs.push(args); },
        } as any;
        applyPerspectiveTilt(ctx, 1080, 1920, 0.3, 0.2);
        expect(transformCalled).toBe(true);
        expect(transformArgs[0].length).toBe(6); // a, b, c, d, e, f
    });

    it('produces identity-like transform for zero tilt', () => {
        const transformArgs: any[] = [];
        const ctx = {
            transform: (...args: any[]) => { transformArgs.push(args); },
        } as any;
        applyPerspectiveTilt(ctx, 1080, 1920, 0, 0);
        // sx ≈ 1, sy ≈ 1, skewX ≈ 0, skewY ≈ 0
        const [a, b, c, d] = transformArgs[0];
        expect(a).toBeCloseTo(1, 5);
        expect(d).toBeCloseTo(1, 5);
        expect(b).toBeCloseTo(0, 5);
        expect(c).toBeCloseTo(0, 5);
    });
});

// ─── BPM Detection Tests ─────────────────────────────────────────────

describe('detectBPM', () => {
    function makeAudioBuffer(sampleRate: number, duration: number, samples: Float32Array): AudioBuffer {
        return {
            sampleRate,
            length: samples.length,
            duration,
            numberOfChannels: 1,
            getChannelData: () => samples,
            copyFromChannel: () => {},
            copyToChannel: () => {},
        } as unknown as AudioBuffer;
    }

    it('detects BPM from periodic beat pattern', () => {
        const sampleRate = 8000;
        const duration = 5;
        const numSamples = sampleRate * duration;
        const samples = new Float32Array(numSamples);

        // Create beats at 120 BPM = 2 beats/sec = every 0.5s
        const beatInterval = 0.5; // seconds
        const beatSamples = Math.floor(sampleRate * 0.02); // 20ms kick

        for (let beat = 0; beat < duration / beatInterval; beat++) {
            const start = Math.floor(beat * beatInterval * sampleRate);
            for (let i = 0; i < beatSamples; i++) {
                samples[start + i] = 0.9 * Math.sin(i * 0.5);
            }
        }

        const buffer = makeAudioBuffer(sampleRate, duration, samples);
        const bpm = detectBPM(buffer);
        expect(bpm).toBeGreaterThan(100);
        expect(bpm).toBeLessThan(140);
    });

    it('returns a value in valid BPM range', () => {
        const sampleRate = 8000;
        const samples = new Float32Array(sampleRate * 2);
        // Fill with noise
        for (let i = 0; i < samples.length; i++) {
            samples[i] = (Math.random() - 0.5) * 0.1;
        }
        const buffer = makeAudioBuffer(sampleRate, 2, samples);
        const bpm = detectBPM(buffer);
        expect(bpm).toBeGreaterThanOrEqual(60);
        expect(bpm).toBeLessThanOrEqual(200);
    });
});

// ─── Beat Snapping Tests ─────────────────────────────────────────────

describe('findNearestBeat', () => {
    it('returns target time when no beats', () => {
        expect(findNearestBeat([], 1.5)).toBe(1.5);
    });

    it('finds the nearest beat', () => {
        const beats = [1.0, 2.0, 3.0, 4.0];
        expect(findNearestBeat(beats, 1.4)).toBe(1.0);
        expect(findNearestBeat(beats, 1.6)).toBe(2.0);
        expect(findNearestBeat(beats, 2.9)).toBe(3.0);
    });

    it('handles exact beat time', () => {
        const beats = [1.0, 2.0, 3.0];
        expect(findNearestBeat(beats, 2.0)).toBe(2.0);
    });
});

describe('snapBoundariesToBeats', () => {
    it('returns unchanged when no beats', () => {
        const boundaries = [1.0, 2.0, 3.0];
        expect(snapBoundariesToBeats(boundaries, [])).toEqual(boundaries);
    });

    it('snaps boundaries within maxSnapDistance', () => {
        const beats = [1.0, 2.0, 3.05, 4.0];
        const boundaries = [1.0, 2.0, 3.0, 4.0];
        const snapped = snapBoundariesToBeats(boundaries, beats, 0.3);
        // 3.0 is within 0.3 of 3.05, so it should snap
        expect(snapped[2]).toBeCloseTo(3.05, 5);
    });

    it('does not snap boundaries beyond maxSnapDistance', () => {
        const beats = [1.0, 2.0, 3.5, 4.0];
        const boundaries = [1.0, 2.0, 3.0, 4.0];
        const snapped = snapBoundariesToBeats(boundaries, beats, 0.3);
        // 3.0 is 0.5 away from 3.5, beyond 0.3 — should not snap
        expect(snapped[2]).toBe(3.0);
    });

    it('preserves the first boundary', () => {
        const beats = [0.1, 1.0, 2.0];
        const boundaries = [0.0, 1.0, 2.0];
        const snapped = snapBoundariesToBeats(boundaries, beats, 0.3);
        expect(snapped[0]).toBe(0.0); // First boundary never snaps
    });
});

// ─── Viral Score Tests ───────────────────────────────────────────────

describe('computeViralScore', () => {
    const baseSettings: VisualSettings = {
        brightness: 1, contrast: 1, saturation: 1, enableZoom: true,
    };

    it('returns low score for empty settings', () => {
        const score = computeViralScore(baseSettings, 3);
        expect(score.total).toBeLessThan(30);
        expect(score.suggestions.length).toBeGreaterThan(0);
    });

    it('scores higher with per-scene overrides', () => {
        const settings: VisualSettings = {
            ...baseSettings,
            perSceneOverrides: {
                0: { colorLUT: 'teal-orange', transitionEffect: 'glitch', textAnimation: 'bounce-in', motionDirection: 'zoom-in', motionIntensity: 0.7 },
                1: { colorLUT: 'golden-hour', transitionEffect: 'zoom-blur', textAnimation: 'fade-up', motionDirection: 'pan-right', motionIntensity: 0.5 },
                2: { colorLUT: 'film-stock', transitionEffect: 'fade', textAnimation: 'fade-up', motionDirection: 'zoom-out', motionIntensity: 0.4 },
            },
            enableBeatZoom: true,
            enableParallax: true,
            enableParticles: true,
            enableLightLeaks: true,
            grain: 0.05,
            vignette: 0.3,
        };
        const score = computeViralScore(settings, 3);
        expect(score.total).toBeGreaterThan(50);
        expect(score.variety).toBeGreaterThan(15);
        expect(score.polish).toBeGreaterThan(15);
    });

    it('rewards beat zoom and opening zoom-in', () => {
        const settings: VisualSettings = {
            ...baseSettings,
            enableBeatZoom: true,
            perSceneOverrides: {
                0: { motionDirection: 'zoom-in', motionIntensity: 0.7, transitionEffect: 'glitch', colorLUT: 'teal-orange', textAnimation: 'bounce-in' },
            },
        };
        const score = computeViralScore(settings, 3);
        expect(score.pacing).toBeGreaterThan(10);
        expect(score.energy).toBeGreaterThan(10);
    });

    it('provides suggestions for missing features', () => {
        const score = computeViralScore(baseSettings, 4);
        expect(score.suggestions).toContain('Use AI Auto-Direct to give each scene unique visual style');
        expect(score.suggestions).toContain('Apply a Color LUT for professional grading');
    });

    it('total equals sum of breakdown scores', () => {
        const settings: VisualSettings = {
            ...baseSettings,
            colorLUT: 'teal-orange',
            textAnimation: 'bounce-in',
            enableBeatZoom: true,
            motionIntensity: 0.6,
            enableParallax: true,
            enableParticles: true,
            grain: 0.05,
        };
        const score = computeViralScore(settings, 3);
        expect(score.total).toBe(score.variety + score.energy + score.pacing + score.polish);
    });
});
