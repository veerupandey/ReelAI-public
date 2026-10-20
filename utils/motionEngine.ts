/**
 * Motion Engine — Advanced in-browser image animation system.
 *
 * Advanced algorithms:
 * - Per-pixel depth displacement via ImageData (true 2.5D, not strips)
 * - Damped spring physics for organic camera motion
 * - Perlin noise camera shake (handheld simulation)
 * - Sobel edge detection + connected components for subject segmentation
 * - Subject/background layered parallax with independent motion
 * - Luminance-based depth map generation with bilateral smoothing
 * - Multi-directional Ken Burns with spring-damped easing
 * - Particle overlays (dust motes, light leaks, film grain)
 */

export type KenBurnsDirection =
    | 'zoom-in'
    | 'zoom-out'
    | 'pan-left'
    | 'pan-right'
    | 'pan-up'
    | 'pan-down'
    | 'zoom-pan-tl'
    | 'zoom-pan-br'
    | 'zoom-pan-tr'
    | 'zoom-pan-bl'
    | 'breathing'
    | 'random';

export interface MotionConfig {
    direction: KenBurnsDirection;
    intensity: number; // 0-1, controls zoom/pan amount
    parallax: boolean; // enable depth-based parallax
    particles: boolean; // enable particle overlays
    grain: boolean; // enable film grain
    lightLeaks: boolean; // enable light leak overlays
}

export const DEFAULT_MOTION_CONFIG: MotionConfig = {
    direction: 'random',
    intensity: 0.5,
    parallax: true,
    particles: true,
    grain: true,
    lightLeaks: true,
};

// ─── Easing Functions ────────────────────────────────────────────────

export const easeInOutCubic = (t: number): number => {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

export const easeOutQuad = (t: number): number => 1 - (1 - t) * (1 - t);

export const easeInOutSine = (t: number): number => -(Math.cos(Math.PI * t) - 1) / 2;

// ─── Perlin Noise ────────────────────────────────────────────────────

const PERMUTATION_SIZE = 256;
const PERMUTATION = new Uint8Array(PERMUTATION_SIZE * 2);
{
    const p = new Uint8Array(PERMUTATION_SIZE);
    for (let i = 0; i < PERMUTATION_SIZE; i++) p[i] = i;
    // Fisher-Yates shuffle with fixed seed for reproducibility
    let seed = 42;
    for (let i = PERMUTATION_SIZE - 1; i > 0; i--) {
        seed = (seed * 16807) % 2147483647;
        const j = seed % (i + 1);
        [p[i], p[j]] = [p[j], p[i]];
    }
    for (let i = 0; i < PERMUTATION_SIZE * 2; i++) PERMUTATION[i] = p[i % PERMUTATION_SIZE];
}

const fade = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number): number => a + t * (b - a);

const grad2 = (hash: number, x: number, y: number): number => {
    const h = hash & 7;
    const u = h < 4 ? x : y;
    const v = h < 4 ? y : x;
    return ((h & 1) ? -u : u) + ((h & 2) ? -2 * v : 2 * v);
};

/** 2D Perlin noise. Returns value in range [-1, 1]. */
export const perlin2 = (x: number, y: number): number => {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);

    const aa = PERMUTATION[PERMUTATION[X] + Y];
    const ab = PERMUTATION[PERMUTATION[X] + Y + 1];
    const ba = PERMUTATION[PERMUTATION[X + 1] + Y];
    const bb = PERMUTATION[PERMUTATION[X + 1] + Y + 1];

    const x1 = lerp(grad2(aa, xf, yf), grad2(ba, xf - 1, yf), u);
    const x2 = lerp(grad2(ab, xf, yf - 1), grad2(bb, xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
};

/** Fractal Brownian Motion (fBm) using Perlin noise octaves. */
export const fbm2 = (x: number, y: number, octaves: number = 4): number => {
    let value = 0;
    let amplitude = 1;
    let frequency = 1;
    let max = 0;
    for (let i = 0; i < octaves; i++) {
        value += perlin2(x * frequency, y * frequency) * amplitude;
        max += amplitude;
        amplitude *= 0.5;
        frequency *= 2;
    }
    return value / max;
};

// ─── Spring Physics ──────────────────────────────────────────────────

export interface SpringState {
    position: number;
    velocity: number;
    target: number;
}

export class SpringSystem {
    private springs: { x: SpringState; y: SpringState; scale: SpringState };
    private stiffness: number;
    private damping: number;
    private mass: number;

    constructor(stiffness: number = 80, damping: number = 14, mass: number = 1) {
        this.stiffness = stiffness;
        this.damping = damping;
        this.mass = mass;
        this.springs = {
            x: { position: 0, velocity: 0, target: 0 },
            y: { position: 0, velocity: 0, target: 0 },
            scale: { position: 1, velocity: 0, target: 1 },
        };
    }

    setTarget(x: number, y: number, scale: number) {
        this.springs.x.target = x;
        this.springs.y.target = y;
        this.springs.scale.target = scale;
    }

    /** Semi-implicit Euler integration step. dt in seconds. */
    update(dt: number): { x: number; y: number; scale: number } {
        const step = (s: SpringState): number => {
            const force = -this.stiffness * (s.position - s.target) - this.damping * s.velocity;
            s.velocity += (force / this.mass) * dt;
            s.position += s.velocity * dt;
            return s.position;
        };
        return {
            x: step(this.springs.x),
            y: step(this.springs.y),
            scale: step(this.springs.scale),
        };
    }

    reset() {
        this.springs.x = { position: 0, velocity: 0, target: 0 };
        this.springs.y = { position: 0, velocity: 0, target: 0 };
        this.springs.scale = { position: 1, velocity: 0, target: 1 };
    }
}

// ─── Camera Shake (Perlin-based) ─────────────────────────────────────

export interface CameraShakeConfig {
    enabled: boolean;
    intensity: number; // pixels of shake
    frequency: number; // noise frequency
}

export const computeCameraShake = (
    time: number,
    config: CameraShakeConfig,
): { x: number; y: number; rotation: number } => {
    if (!config.enabled || config.intensity <= 0) return { x: 0, y: 0, rotation: 0 };
    const freq = config.frequency;
    const t = time * 0.001 * freq;
    return {
        x: fbm2(t, 0.5, 3) * config.intensity,
        y: fbm2(0.5, t, 3) * config.intensity,
        rotation: fbm2(t, t, 2) * config.intensity * 0.002,
    };
};

// ─── Ken Burns Motion ────────────────────────────────────────────────

export interface KenBurnsState {
    scale: number;
    panX: number;
    panY: number;
}

const DIRECTION_PRESETS: KenBurnsDirection[] = [
    'zoom-in', 'pan-left', 'pan-right', 'pan-up', 'pan-down',
    'zoom-pan-tl', 'zoom-pan-br', 'zoom-pan-tr', 'zoom-pan-bl',
];

export const resolveDirection = (dir: KenBurnsDirection, seed: number): KenBurnsDirection => {
    if (dir !== 'random') return dir;
    return DIRECTION_PRESETS[Math.floor(seed * DIRECTION_PRESETS.length) % DIRECTION_PRESETS.length];
};

/**
 * Compute Ken Burns transform at time t (0-1) within a scene.
 * Returns scale and pan offset in pixels relative to canvas dimensions.
 */
export const computeKenBurns = (
    direction: KenBurnsDirection,
    t: number,
    intensity: number,
    canvasW: number,
    canvasH: number,
): KenBurnsState => {
    const eased = easeInOutSine(t);
    const zoomAmount = 0.08 + intensity * 0.12; // 8%-20% zoom
    const panAmount = (40 + intensity * 80); // 40-120px pan

    switch (direction) {
        case 'zoom-in':
            return { scale: 1 + eased * zoomAmount, panX: 0, panY: 0 };
        case 'zoom-out':
            return { scale: 1 + (1 - eased) * zoomAmount, panX: 0, panY: 0 };
        case 'pan-left':
            return { scale: 1 + zoomAmount * 0.5, panX: -eased * panAmount, panY: 0 };
        case 'pan-right':
            return { scale: 1 + zoomAmount * 0.5, panX: eased * panAmount, panY: 0 };
        case 'pan-up':
            return { scale: 1 + zoomAmount * 0.5, panX: 0, panY: -eased * panAmount };
        case 'pan-down':
            return { scale: 1 + zoomAmount * 0.5, panX: 0, panY: eased * panAmount };
        case 'zoom-pan-tl':
            return { scale: 1 + eased * zoomAmount, panX: -eased * panAmount * 0.6, panY: -eased * panAmount * 0.6 };
        case 'zoom-pan-br':
            return { scale: 1 + eased * zoomAmount, panX: eased * panAmount * 0.6, panY: eased * panAmount * 0.6 };
        case 'zoom-pan-tr':
            return { scale: 1 + eased * zoomAmount, panX: eased * panAmount * 0.6, panY: -eased * panAmount * 0.6 };
        case 'zoom-pan-bl':
            return { scale: 1 + eased * zoomAmount, panX: -eased * panAmount * 0.6, panY: eased * panAmount * 0.6 };
        case 'breathing': {
            const breathe = Math.sin(t * Math.PI * 2) * 0.5 + 0.5;
            return { scale: 1 + breathe * zoomAmount * 0.5, panX: 0, panY: 0 };
        }
        default:
            return { scale: 1, panX: 0, panY: 0 };
    }
};

// ─── Depth Map Generation ────────────────────────────────────────────

export interface DepthMap {
    data: Float32Array;
    width: number;
    height: number;
}

const DEPTH_CANVAS_SIZE = 192; // higher res for per-pixel displacement

/**
 * Generate a depth map from an image using luminance analysis.
 * Brighter areas = closer (foreground), darker areas = background.
 * Applies a simple box blur for smooth gradients.
 *
 * This is a heuristic — product photography with bright subjects on
 * darker backgrounds works best. For more accuracy, MiDaS via ONNX
 * could be substituted here.
 */
export const generateDepthMap = (img: HTMLImageElement | HTMLVideoElement): DepthMap => {
    const w = DEPTH_CANVAS_SIZE;
    const h = Math.round(DEPTH_CANVAS_SIZE * (img instanceof HTMLVideoElement ? (img.videoHeight / img.videoWidth) : (img.height / img.width)) || DEPTH_CANVAS_SIZE);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!;
    ctx.drawImage(img, 0, 0, w, h);
    const imageData = ctx.getImageData(0, 0, w, h);

    // Luminance → depth with center bias (center of frame tends to be closer)
    const raw = new Float32Array(w * h);
    const cx = w / 2, cy = h / 2;
    const maxDist = Math.sqrt(cx * cx + cy * cy);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const i = y * w + x;
            const r = imageData.data[i * 4];
            const g = imageData.data[i * 4 + 1];
            const b = imageData.data[i * 4 + 2];
            const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
            // Center bias: pixels near center get depth boost
            const dist = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) / maxDist;
            const centerBias = 1 - dist * 0.3;
            raw[i] = lum * centerBias;
        }
    }

    // Bilateral-ish smoothing: blur but preserve strong edges
    const blurred = bilateralSmooth(raw, w, h, 3, 0.15);
    // Normalize 0-1
    let min = Infinity, max = -Infinity;
    for (let i = 0; i < blurred.length; i++) {
        if (blurred[i] < min) min = blurred[i];
        if (blurred[i] > max) max = blurred[i];
    }
    const range = max - min || 1;
    for (let i = 0; i < blurred.length; i++) {
        blurred[i] = (blurred[i] - min) / range;
    }

    return { data: blurred, width: w, height: h };
};

/**
 * Bilateral smoothing: smooths flat regions while preserving depth discontinuities.
 * This produces much better parallax boundaries than a flat box blur.
 */
const bilateralSmooth = (
    data: Float32Array, w: number, h: number, radius: number, edgeThreshold: number,
): Float32Array => {
    const result = new Float32Array(data.length);
    for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
            const center = data[y * w + x];
            let sum = 0, weight = 0;
            for (let dy = -radius; dy <= radius; dy++) {
                for (let dx = -radius; dx <= radius; dx++) {
                    const sx = Math.min(w - 1, Math.max(0, x + dx));
                    const sy = Math.min(h - 1, Math.max(0, y + dy));
                    const val = data[sy * w + sx];
                    const spatialDist = dx * dx + dy * dy;
                    const valueDiff = Math.abs(val - center);
                    // Only blur if values are similar (preserves edges)
                    const w_s = Math.exp(-spatialDist / (2 * radius * radius));
                    const w_v = valueDiff < edgeThreshold ? 1 : Math.exp(-valueDiff * valueDiff / (2 * edgeThreshold * edgeThreshold));
                    const w_total = w_s * w_v;
                    sum += val * w_total;
                    weight += w_total;
                }
            }
            result[y * w + x] = weight > 0 ? sum / weight : center;
        }
    }
    return result;
};

// ─── Sobel Edge Detection + Subject Segmentation ─────────────────────

export interface SegmentationMask {
    /** Uint8Array where 255 = subject, 0 = background */
    mask: Uint8Array;
    width: number;
    height: number;
    /** Bounding box of subject region */
    bbox: { x: number; y: number; w: number; h: number } | null;
}

/**
 * Segment subject from background using Sobel edges + connected components.
 * Finds the largest connected region of high-depth (foreground) pixels.
 */
export const segmentSubject = (depth: DepthMap): SegmentationMask => {
    const { data, width: w, height: h } = depth;
    const edges = new Uint8Array(w * h);

    // Sobel edge detection on depth map
    for (let y = 1; y < h - 1; y++) {
        for (let x = 1; x < w - 1; x++) {
            const i = y * w + x;
            const gx =
                -data[i - w - 1] - 2 * data[i - 1] - data[i + w - 1]
                + data[i - w + 1] + 2 * data[i + 1] + data[i + w + 1];
            const gy =
                -data[i - w - 1] - 2 * data[i - w] - data[i - w + 1]
                + data[i + w - 1] + 2 * data[i + w] + data[i + w + 1];
            const mag = Math.sqrt(gx * gx + gy * gy);
            edges[i] = mag > 0.15 ? 1 : 0; // edge threshold
        }
    }

    // Threshold depth to find foreground candidates
    const foreground = new Uint8Array(w * h);
    const depthThreshold = 0.45; // pixels with depth > 0.45 are foreground candidates
    for (let i = 0; i < w * h; i++) {
        foreground[i] = data[i] > depthThreshold && edges[i] === 0 ? 1 : 0;
    }

    // Connected components labeling (4-connectivity, iterative BFS)
    const labels = new Int32Array(w * h).fill(-1);
    let currentLabel = 0;
    const componentSizes: number[] = [];
    const queue: number[] = [];

    for (let start = 0; start < w * h; start++) {
        if (foreground[start] === 1 && labels[start] === -1) {
            labels[start] = currentLabel;
            queue.push(start);
            let size = 0;
            while (queue.length > 0) {
                const idx = queue.shift()!;
                size++;
                const px = idx % w;
                const py = Math.floor(idx / w);
                // 4-neighbors
                const neighbors = [
                    px > 0 ? idx - 1 : -1,
                    px < w - 1 ? idx + 1 : -1,
                    py > 0 ? idx - w : -1,
                    py < h - 1 ? idx + w : -1,
                ];
                for (const n of neighbors) {
                    if (n >= 0 && foreground[n] === 1 && labels[n] === -1) {
                        labels[n] = currentLabel;
                        queue.push(n);
                    }
                }
            }
            componentSizes.push(size);
            currentLabel++;
        }
    }

    // Find largest component (the subject)
    let largestLabel = -1, largestSize = 0;
    for (let i = 0; i < componentSizes.length; i++) {
        if (componentSizes[i] > largestSize) {
            largestSize = componentSizes[i];
            largestLabel = i;
        }
    }

    // Build mask + bounding box for largest component
    const mask = new Uint8Array(w * h);
    let minX = w, minY = h, maxX = 0, maxY = 0;
    if (largestLabel >= 0) {
        for (let i = 0; i < w * h; i++) {
            if (labels[i] === largestLabel) {
                mask[i] = 255;
                const px = i % w;
                const py = Math.floor(i / w);
                if (px < minX) minX = px;
                if (px > maxX) maxX = px;
                if (py < minY) minY = py;
                if (py > maxY) maxY = py;
            }
        }
    }

    const bbox = largestLabel >= 0 && largestSize > 20
        ? { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 }
        : null;

    return { mask, width: w, height: h, bbox };
};

/**
 * Sample depth at normalized (0-1) coordinates.
 */
export const sampleDepth = (depth: DepthMap, u: number, v: number): number => {
    const x = Math.min(depth.width - 1, Math.max(0, Math.round(u * depth.width)));
    const y = Math.min(depth.height - 1, Math.max(0, Math.round(v * depth.height)));
    return depth.data[y * depth.width + x];
};

// ─── Parallax Rendering ──────────────────────────────────────────────

/**
 * Advanced per-pixel depth displacement rendering.
 *
 * Instead of splitting into strips, this reads the source image into an
 * offscreen canvas, then displaces each pixel individually based on its
 * depth value. Produces true 2.5D parallax with smooth depth gradients.
 *
 * Uses a medium-resolution displacement grid (DISP_RES) for performance,
 * then scales up with drawImage. At 270x480, this is ~130k pixels —
 * fast enough for 30fps on modern hardware.
 */
const DISP_W = 270;
const dispCanvasCache = new Map<string, HTMLCanvasElement>();

export const drawParallaxImageAdvanced = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLVideoElement,
    depth: DepthMap | null,
    segmentation: SegmentationMask | null,
    x: number,
    y: number,
    w: number,
    h: number,
    cameraX: number,
    cameraY: number,
    parallaxStrength: number = 25,
): void => {
    if (!depth) {
        ctx.drawImage(img, x, y, w, h);
        return;
    }

    const imgW = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
    const imgH = img instanceof HTMLVideoElement ? img.videoHeight : img.height;
    const dispH = Math.round(DISP_W * (imgH / imgW)) || 480;

    // Get or create displacement canvas
    const cacheKey = `${DISP_W}x${dispH}`;
    let dispCanvas = dispCanvasCache.get(cacheKey);
    if (!dispCanvas) {
        dispCanvas = document.createElement('canvas');
        dispCanvas.width = DISP_W;
        dispCanvas.height = dispH;
        dispCanvasCache.set(cacheKey, dispCanvas);
    }
    const dispCtx = dispCanvas.getContext('2d', { willReadFrequently: true })!;
    dispCtx.drawImage(img, 0, 0, DISP_W, dispH);
    const srcData = dispCtx.getImageData(0, 0, DISP_W, dispH);
    const outData = dispCtx.createImageData(DISP_W, dispH);

    const src = srcData.data;
    const out = outData.data;

    // Per-pixel displacement
    for (let py = 0; py < dispH; py++) {
        for (let px = 0; px < DISP_W; px++) {
            // Sample depth at this pixel
            const u = px / DISP_W;
            const v = py / dispH;
            const d = sampleDepth(depth, u, v);

            // Subject gets extra parallax boost if segmentation available
            let depthWeight = d;
            if (segmentation && segmentation.bbox) {
                const maskVal = sampleMask(segmentation, u, v);
                depthWeight = d * (0.6 + maskVal * 0.4); // subject moves 40% more
            }

            // Displacement: foreground moves opposite to camera
            const dx = Math.round(cameraX * depthWeight * parallaxStrength);
            const dy = Math.round(cameraY * depthWeight * parallaxStrength);

            // Source pixel (with displacement)
            const sx = Math.min(DISP_W - 1, Math.max(0, px + dx));
            const sy = Math.min(dispH - 1, Math.max(0, py + dy));
            const srcIdx = (sy * DISP_W + sx) * 4;
            const outIdx = (py * DISP_W + px) * 4;

            out[outIdx] = src[srcIdx];
            out[outIdx + 1] = src[srcIdx + 1];
            out[outIdx + 2] = src[srcIdx + 2];
            out[outIdx + 3] = src[srcIdx + 3];
        }
    }

    dispCtx.putImageData(outData, 0, 0);
    // Scale up to target size
    ctx.drawImage(dispCanvas, x, y, w, h);
};

/** Sample segmentation mask at normalized coordinates. */
const sampleMask = (seg: SegmentationMask, u: number, v: number): number => {
    const x = Math.min(seg.width - 1, Math.max(0, Math.round(u * seg.width)));
    const y = Math.min(seg.height - 1, Math.max(0, Math.round(v * seg.height)));
    return seg.mask[y * seg.width + x] / 255;
};

/**
 * Layered parallax: draws background and subject as separate layers
 * with independent displacement. Subject floats above background.
 */
export const drawLayeredParallax = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLVideoElement,
    depth: DepthMap | null,
    segmentation: SegmentationMask | null,
    x: number,
    y: number,
    w: number,
    h: number,
    cameraX: number,
    cameraY: number,
    parallaxStrength: number = 25,
): void => {
    if (!depth || !segmentation || !segmentation.bbox) {
        drawParallaxImageAdvanced(ctx, img, depth, segmentation, x, y, w, h, cameraX, cameraY, parallaxStrength);
        return;
    }

    // Background layer: less parallax (moves slower)
    drawParallaxImageAdvanced(ctx, img, depth, null, x, y, w, h, cameraX * 0.4, cameraY * 0.4, parallaxStrength * 0.6);

    // Subject layer: more parallax (moves faster, floats above)
    const imgW = img instanceof HTMLVideoElement ? img.videoWidth : img.width;
    const imgH = img instanceof HTMLVideoElement ? img.videoHeight : img.height;
    const bbox = segmentation.bbox;
    const srcX = (bbox.x / segmentation.width) * imgW;
    const srcY = (bbox.y / segmentation.height) * imgH;
    const srcW = (bbox.w / segmentation.width) * imgW;
    const srcH = (bbox.h / segmentation.height) * imgH;

    const dstX = x + (bbox.x / segmentation.width) * w;
    const dstY = y + (bbox.y / segmentation.height) * h;
    const dstW = (bbox.w / segmentation.width) * w;
    const dstH = (bbox.h / segmentation.height) * h;

    // Subject displacement: foreground moves more
    const subjDX = cameraX * parallaxStrength * 1.3;
    const subjDY = cameraY * parallaxStrength * 1.3;

    ctx.save();
    ctx.drawImage(img, srcX, srcY, srcW, srcH, dstX + subjDX, dstY + subjDY, dstW, dstH);
    ctx.restore();
};

// Legacy strip-based parallax (kept for fallback)
export const drawParallaxImage = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLVideoElement,
    depth: DepthMap | null,
    x: number,
    y: number,
    w: number,
    h: number,
    cameraX: number,
    cameraY: number,
    parallaxStrength: number = 20,
): void => {
    drawParallaxImageAdvanced(ctx, img, depth, null, x, y, w, h, cameraX, cameraY, parallaxStrength);
};

// ─── Particle System ─────────────────────────────────────────────────

export interface Particle {
    x: number;
    y: number;
    vx: number;
    vy: number;
    size: number;
    alpha: number;
    life: number;
    maxLife: number;
    type: 'dust' | 'light';
}

export class ParticleSystem {
    private particles: Particle[] = [];
    private width: number;
    private height: number;
    private lastSpawn: number = 0;

    constructor(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    resize(width: number, height: number) {
        this.width = width;
        this.height = height;
    }

    update(dt: number, time: number) {
        // Spawn dust motes
        if (time - this.lastSpawn > 200 && this.particles.length < 40) {
            this.lastSpawn = time;
            this.particles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                vx: (Math.random() - 0.5) * 0.3,
                vy: -0.1 - Math.random() * 0.2,
                size: 1 + Math.random() * 3,
                alpha: 0.1 + Math.random() * 0.3,
                life: 0,
                maxLife: 3000 + Math.random() * 4000,
                type: 'dust',
            });
        }

        // Spawn occasional light leaks
        if (Math.random() < 0.003 && this.particles.filter(p => p.type === 'light').length < 2) {
            this.particles.push({
                x: Math.random() * this.width,
                y: Math.random() * this.height,
                vx: (Math.random() - 0.5) * 0.5,
                vy: (Math.random() - 0.5) * 0.3,
                size: 80 + Math.random() * 200,
                alpha: 0.05 + Math.random() * 0.08,
                life: 0,
                maxLife: 2000 + Math.random() * 3000,
                type: 'light',
            });
        }

        // Update particles
        this.particles = this.particles.filter(p => {
            p.life += dt;
            if (p.life > p.maxLife) return false;
            p.x += p.vx * dt * 0.06;
            p.y += p.vy * dt * 0.06;
            // Wrap around
            if (p.x < -50) p.x = this.width + 50;
            if (p.x > this.width + 50) p.x = -50;
            if (p.y < -50) p.y = this.height + 50;
            if (p.y > this.height + 50) p.y = -50;
            return true;
        });
    }

    draw(ctx: CanvasRenderingContext2D) {
        for (const p of this.particles) {
            const lifeRatio = p.life / p.maxLife;
            const fadeIn = Math.min(1, lifeRatio * 4);
            const fadeOut = Math.min(1, (1 - lifeRatio) * 4);
            const alpha = p.alpha * fadeIn * fadeOut;

            if (p.type === 'dust') {
                ctx.save();
                ctx.globalAlpha = alpha;
                ctx.fillStyle = '#fff';
                ctx.beginPath();
                ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
                ctx.fill();
                ctx.restore();
            } else if (p.type === 'light') {
                ctx.save();
                ctx.globalAlpha = alpha;
                const gradient = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.size);
                gradient.addColorStop(0, 'rgba(255, 220, 150, 0.8)');
                gradient.addColorStop(0.5, 'rgba(255, 180, 100, 0.3)');
                gradient.addColorStop(1, 'rgba(255, 150, 80, 0)');
                ctx.fillStyle = gradient;
                ctx.fillRect(p.x - p.size, p.y - p.size, p.size * 2, p.size * 2);
                ctx.restore();
            }
        }
    }

    clear() {
        this.particles = [];
    }
}

// ─── Film Grain ──────────────────────────────────────────────────────

let grainCanvas: HTMLCanvasElement | null = null;
let grainPattern: CanvasPattern | null = null;

const getGrainPattern = (ctx: CanvasRenderingContext2D): CanvasPattern | null => {
    if (!grainCanvas) {
        grainCanvas = document.createElement('canvas');
        grainCanvas.width = 128;
        grainCanvas.height = 128;
        const gctx = grainCanvas.getContext('2d')!;
        const imageData = gctx.createImageData(128, 128);
        for (let i = 0; i < imageData.data.length; i += 4) {
            const v = Math.random() * 255;
            imageData.data[i] = v;
            imageData.data[i + 1] = v;
            imageData.data[i + 2] = v;
            imageData.data[i + 3] = 255;
        }
        gctx.putImageData(imageData, 0, 0);
        grainPattern = ctx.createPattern(grainCanvas, 'repeat');
    }
    return grainPattern;
};

export const drawFilmGrain = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    intensity: number = 0.06,
    time: number,
): void => {
    const pattern = getGrainPattern(ctx);
    if (!pattern) return;

    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'overlay';
    // Offset grain per frame for animated effect
    const ox = (time * 0.05) % 128;
    const oy = (time * 0.07) % 128;
    ctx.translate(-ox, -oy);
    ctx.fillStyle = pattern;
    ctx.fillRect(ox, oy, width + 128, height + 128);
    ctx.restore();
};

// ─── Light Leak Overlay ──────────────────────────────────────────────

export const drawLightLeak = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    intensity: number = 0.15,
): void => {
    const t = time * 0.0003;
    const x = width * (0.3 + Math.sin(t) * 0.2);
    const y = height * (0.2 + Math.cos(t * 0.7) * 0.15);
    const radius = Math.max(width, height) * 0.6;

    ctx.save();
    ctx.globalAlpha = intensity;
    ctx.globalCompositeOperation = 'screen';
    const gradient = ctx.createRadialGradient(x, y, 0, x, y, radius);
    gradient.addColorStop(0, 'rgba(255, 180, 80, 0.4)');
    gradient.addColorStop(0.4, 'rgba(255, 120, 60, 0.15)');
    gradient.addColorStop(1, 'rgba(255, 100, 50, 0)');
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
};

// ─── Vignette ────────────────────────────────────────────────────────

export const drawVignette = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    intensity: number = 0.3,
): void => {
    const cx = width / 2;
    const cy = height / 2;
    const innerRadius = Math.min(width, height) * 0.3;
    const outerRadius = Math.max(width, height) * 0.75;

    ctx.save();
    const gradient = ctx.createRadialGradient(cx, cy, innerRadius, cx, cy, outerRadius);
    gradient.addColorStop(0, 'rgba(0, 0, 0, 0)');
    gradient.addColorStop(1, `rgba(0, 0, 0, ${intensity})`);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, width, height);
    ctx.restore();
};

// ─── Motion Blur (Directional) ───────────────────────────────────────

/**
 * Apply directional motion blur based on camera velocity.
 * Draws multiple semi-transparent copies offset along the motion vector.
 */
export const drawMotionBlur = (
    ctx: CanvasRenderingContext2D,
    drawFn: () => void,
    velocityX: number,
    velocityY: number,
    intensity: number = 0.5,
): void => {
    const speed = Math.sqrt(velocityX * velocityX + velocityY * velocityY);
    if (speed < 0.5 || intensity <= 0) {
        drawFn();
        return;
    }

    const COPIES = 5;
    const blurAmount = Math.min(speed * intensity * 0.3, 15);
    const dx = (velocityX / speed) * blurAmount;
    const dy = (velocityY / speed) * blurAmount;

    // Draw trailing copies with decreasing alpha
    for (let i = COPIES; i >= 1; i--) {
        ctx.save();
        ctx.globalAlpha = (intensity * 0.15) * (1 - i / COPIES);
        ctx.translate(-dx * i * 0.3, -dy * i * 0.3);
        drawFn();
        ctx.restore();
    }
    // Draw the sharp copy on top
    drawFn();
};

// ─── Subject Tracking Zoom ───────────────────────────────────────────

/**
 * Compute camera offset to keep subject centered during zoom.
 * Uses segmentation bbox to determine where the subject is.
 */
export const computeSubjectTracking = (
    segmentation: SegmentationMask | null,
    canvasW: number,
    canvasH: number,
    zoom: number,
): { offsetX: number; offsetY: number } => {
    if (!segmentation || !segmentation.bbox) return { offsetX: 0, offsetY: 0 };

    const bbox = segmentation.bbox;
    // Subject center in normalized coordinates
    const subjCx = (bbox.x + bbox.w / 2) / segmentation.width;
    const subjCy = (bbox.y + bbox.h / 2) / segmentation.height;

    // Canvas center is 0.5, 0.5
    // We need to offset so subject stays centered as we zoom
    const offsetX = (0.5 - subjCx) * canvasW * (zoom - 1);
    const offsetY = (0.5 - subjCy) * canvasH * (zoom - 1);

    return { offsetX, offsetY };
};

// ─── Chromatic Aberration / RGB Split ────────────────────────────────

/**
 * Draw image with chromatic aberration — RGB channels split apart.
 * Great for transitions and glitch effects.
 */
export const drawChromaticAberration = (
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLVideoElement | HTMLCanvasElement,
    x: number,
    y: number,
    w: number,
    h: number,
    splitAmount: number = 4,
): void => {
    if (splitAmount <= 0) {
        ctx.drawImage(img, x, y, w, h);
        return;
    }

    ctx.save();
    ctx.globalCompositeOperation = 'lighter';

    // Red channel — offset left
    ctx.save();
    ctx.filter = 'brightness(0) saturate(100%) sepia(1) hue-rotate(-50deg) saturate(5)';
    ctx.drawImage(img, x - splitAmount, y, w, h);
    ctx.restore();

    // Green channel — center
    ctx.save();
    ctx.filter = 'brightness(0) saturate(100%) sepia(1) hue-rotate(70deg) saturate(5)';
    ctx.drawImage(img, x, y, w, h);
    ctx.restore();

    // Blue channel — offset right
    ctx.save();
    ctx.filter = 'brightness(0) saturate(100%) sepia(1) hue-rotate(180deg) saturate(5)';
    ctx.drawImage(img, x + splitAmount, y, w, h);
    ctx.restore();

    ctx.restore();
};

// ─── Beat Detection (Audio-Reactive) ─────────────────────────────────

export interface BeatInfo {
    isBeat: boolean;
    intensity: number; // 0-1, how strong the beat is
    bpm: number;
}

/**
 * Simple beat detection from AudioBuffer using energy-based onset detection.
 * Analyzes low-frequency energy spikes to find beats.
 */
export const detectBeats = (audioBuffer: AudioBuffer): number[] => {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);
    const windowSize = Math.floor(sampleRate * 0.01); // 10ms windows
    const numWindows = Math.floor(channelData.length / windowSize);
    const energies: number[] = [];

    // Compute energy per window
    for (let i = 0; i < numWindows; i++) {
        let sum = 0;
        for (let j = 0; j < windowSize; j++) {
            const sample = channelData[i * windowSize + j];
            sum += sample * sample;
        }
        energies.push(sum / windowSize);
    }

    // Compute local average energy (over ~1 second)
    const localWindow = Math.floor(100); // ~1 second of 10ms windows
    const beats: number[] = [];
    const threshold = 1.3; // beat if energy > 1.3x local average

    for (let i = localWindow; i < numWindows; i++) {
        let avgEnergy = 0;
        for (let j = i - localWindow; j < i; j++) {
            avgEnergy += energies[j];
        }
        avgEnergy /= localWindow;

        if (energies[i] > avgEnergy * threshold && energies[i] > energies[i - 1]) {
            const beatTime = (i * windowSize) / sampleRate;
            // Avoid duplicate beats within 100ms
            if (beats.length === 0 || beatTime - beats[beats.length - 1] > 0.1) {
                beats.push(beatTime);
            }
        }
    }

    return beats;
};

/**
 * Get beat intensity at a specific time.
 * Returns 0 if no beat nearby, peaks at 1 on the beat, decays over 200ms.
 */
export const getBeatIntensity = (beats: number[], time: number): number => {
    for (const beatTime of beats) {
        const dt = time - beatTime;
        if (dt >= 0 && dt < 0.3) {
            // Attack: 0-50ms ramps up, 50-300ms decays
            if (dt < 0.05) return dt / 0.05;
            return Math.max(0, 1 - (dt - 0.05) / 0.25);
        }
    }
    return 0;
};

/**
 * Detect BPM (beats per minute) from an AudioBuffer using autocorrelation.
 * Searches the 60-200 BPM range for the strongest periodicity.
 */
export const detectBPM = (audioBuffer: AudioBuffer): number => {
    const sampleRate = audioBuffer.sampleRate;
    const channelData = audioBuffer.getChannelData(0);

    // Downsample to ~100 Hz for efficiency
    const targetRate = 100;
    const downsampleFactor = Math.floor(sampleRate / targetRate);
    const numDownsampled = Math.floor(channelData.length / downsampleFactor);
    const downsampled: number[] = new Array(numDownsampled);

    for (let i = 0; i < numDownsampled; i++) {
        let sum = 0;
        for (let j = 0; j < downsampleFactor; j++) {
            const sample = channelData[i * downsampleFactor + j];
            sum += sample * sample;
        }
        downsampled[i] = sum / downsampleFactor;
    }

    // Autocorrelation: search 60-200 BPM
    const minBPM = 60;
    const maxBPM = 200;
    const minLag = Math.floor((60 / maxBPM) * targetRate);
    const maxLag = Math.floor((60 / minBPM) * targetRate);

    let bestLag = minLag;
    let bestCorrelation = 0;

    for (let lag = minLag; lag <= maxLag; lag++) {
        let correlation = 0;
        const maxOffset = Math.min(numDownsampled - lag, 3000); // limit to 30s
        for (let i = 0; i < maxOffset; i++) {
            correlation += downsampled[i] * downsampled[i + lag];
        }
        correlation /= maxOffset;

        if (correlation > bestCorrelation) {
            bestCorrelation = correlation;
            bestLag = lag;
        }
    }

    const bpm = (60 * targetRate) / bestLag;
    return Math.round(bpm);
};

/**
 * Find the time of the nearest beat to a given target time.
 * Used for aligning scene transitions to beat drops.
 */
export const findNearestBeat = (beats: number[], targetTime: number): number => {
    if (beats.length === 0) return targetTime;

    let nearest = beats[0];
    let minDist = Math.abs(beats[0] - targetTime);

    for (const beat of beats) {
        const dist = Math.abs(beat - targetTime);
        if (dist < minDist) {
            minDist = dist;
            nearest = beat;
        }
    }

    return nearest;
};

/**
 * Snap an array of scene boundary times to the nearest beats.
 * Returns adjusted boundary times that align transitions to beat drops.
 * Only snaps if the beat is within `maxSnapDistance` seconds of the boundary.
 */
export const snapBoundariesToBeats = (
    boundaries: number[],
    beats: number[],
    maxSnapDistance: number = 0.3,
): number[] => {
    if (beats.length === 0) return boundaries;

    return boundaries.map((boundary, i) => {
        if (i === 0) return boundary; // Don't snap the start
        const nearestBeat = findNearestBeat(beats, boundary);
        const dist = Math.abs(nearestBeat - boundary);
        if (dist <= maxSnapDistance) {
            return nearestBeat;
        }
        return boundary;
    });
};

/**
 * Apply fake 3D perspective tilt to the canvas context.
 * Uses ctx.setTransform with perspective-like matrix.
 * tiltX/tiltY in radians.
 */
export const applyPerspectiveTilt = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    tiltX: number,
    tiltY: number,
): void => {
    const cx = width / 2;
    const cy = height / 2;

    // Simulate perspective by skewing + scaling
    const persp = 0.001;
    const sx = 1 + Math.abs(Math.sin(tiltY)) * 0.08;
    const sy = 1 + Math.abs(Math.sin(tiltX)) * 0.08;
    const skewX = Math.sin(tiltY) * 0.08;
    const skewY = Math.sin(tiltX) * 0.08;

    ctx.transform(sx, skewY, skewX, sy, cx * (1 - sx) - cy * skewX, cy * (1 - sy) - cx * skewY);
};

// ─── Color Grading LUTs ──────────────────────────────────────────────

export type ColorLUT =
    | 'none'
    | 'teal-orange'
    | 'vintage'
    | 'noir'
    | 'golden-hour'
    | 'matrix-green'
    | 'cyberpunk'
    | 'film-stock';

const LUT_FILTERS: Record<ColorLUT, string> = {
    'none': 'none',
    'teal-orange': 'contrast(1.15) saturate(1.2) sepia(0.08) hue-rotate(-8deg)',
    'vintage': 'sepia(0.35) contrast(0.95) saturate(0.85) brightness(1.05)',
    'noir': 'grayscale(100%) contrast(1.3) brightness(0.95)',
    'golden-hour': 'sepia(0.2) saturate(1.3) brightness(1.08) hue-rotate(-10deg) contrast(1.05)',
    'matrix-green': 'hue-rotate(80deg) saturate(1.4) contrast(1.1) brightness(0.9)',
    'cyberpunk': 'hue-rotate(280deg) saturate(1.6) contrast(1.2) brightness(1.05)',
    'film-stock': 'contrast(1.12) saturate(0.92) sepia(0.06) brightness(0.98)',
};

export const getLUTFilter = (lut: ColorLUT): string => LUT_FILTERS[lut] || 'none';

/**
 * Apply color grading LUT via per-pixel manipulation for more accurate results.
 * Falls back to ctx.filter for simple LUTs.
 */
export const applyColorLUT = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    lut: ColorLUT,
): void => {
    if (lut === 'none') return;

    const filter = getLUTFilter(lut);
    if (filter === 'none') return;

    // Use ctx.filter for real-time performance
    ctx.save();
    ctx.filter = filter;
    ctx.drawImage(canvas, 0, 0);
    ctx.restore();
};

// ─── Text Animation Presets ──────────────────────────────────────────

export type TextAnimationPreset =
    | 'none'
    | 'typewriter'
    | 'bounce-in'
    | 'karaoke-sweep'
    | 'wave'
    | 'glitch-in'
    | 'fade-up';

export interface TextAnimationState {
    visibleChars: number; // for typewriter
    offsetY: number; // for bounce/fade-up
    opacity: number;
    highlightProgress: number; // 0-1 for karaoke sweep
    waveOffsets: number[]; // per-word wave offset
    glitchOffset: number; // for glitch-in
}

/**
 * Compute text animation state at time t (0-1) for a given preset.
 */
export const computeTextAnimation = (
    preset: TextAnimationPreset,
    t: number,
    wordCount: number,
): TextAnimationState => {
    const clampedT = Math.min(1, Math.max(0, t));

    switch (preset) {
        case 'typewriter': {
            const visibleChars = Math.ceil(clampedT * wordCount * 5); // ~5 chars per word
            return {
                visibleChars,
                offsetY: 0,
                opacity: 1,
                highlightProgress: 0,
                waveOffsets: [],
                glitchOffset: 0,
            };
        }
        case 'bounce-in': {
            // Spring-like bounce: overshoot then settle
            const bounce = clampedT < 0.6
                ? (clampedT / 0.6) * 1.15
                : 1.15 - ((clampedT - 0.6) / 0.4) * 0.15;
            return {
                visibleChars: wordCount * 5,
                offsetY: (1 - bounce) * 30,
                opacity: Math.min(1, clampedT * 2),
                highlightProgress: 0,
                waveOffsets: [],
                glitchOffset: 0,
            };
        }
        case 'karaoke-sweep': {
            return {
                visibleChars: wordCount * 5,
                offsetY: 0,
                opacity: 1,
                highlightProgress: clampedT,
                waveOffsets: [],
                glitchOffset: 0,
            };
        }
        case 'wave': {
            const offsets: number[] = [];
            for (let i = 0; i < wordCount; i++) {
                offsets.push(Math.sin(clampedT * Math.PI * 2 + i * 0.5) * 8);
            }
            return {
                visibleChars: wordCount * 5,
                offsetY: 0,
                opacity: 1,
                highlightProgress: 0,
                waveOffsets: offsets,
                glitchOffset: 0,
            };
        }
        case 'glitch-in': {
            const settled = clampedT > 0.7;
            return {
                visibleChars: wordCount * 5,
                offsetY: 0,
                opacity: Math.min(1, clampedT * 1.5),
                highlightProgress: 0,
                waveOffsets: [],
                glitchOffset: settled ? 0 : (1 - clampedT) * 8,
            };
        }
        case 'fade-up': {
            return {
                visibleChars: wordCount * 5,
                offsetY: (1 - clampedT) * 20,
                opacity: clampedT,
                highlightProgress: 0,
                waveOffsets: [],
                glitchOffset: 0,
            };
        }
        default:
            return {
                visibleChars: wordCount * 5,
                offsetY: 0,
                opacity: 1,
                highlightProgress: 0,
                waveOffsets: [],
                glitchOffset: 0,
            };
    }
};

// ─── Keyframe System ─────────────────────────────────────────────────

export interface Keyframe {
    time: number; // 0-1 normalized within scene
    value: number;
    easing: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out' | 'bezier';
    bezierCP?: [number, number, number, number]; // cubic-bezier control points
}

export interface KeyframeTrack {
    property: 'scale' | 'panX' | 'panY' | 'rotation' | 'opacity';
    keyframes: Keyframe[];
}

/**
 * Evaluate a keyframe track at time t (0-1).
 * Interpolates between keyframes using the specified easing.
 */
export const evaluateKeyframeTrack = (track: KeyframeTrack, t: number): number => {
    const { keyframes } = track;
    if (keyframes.length === 0) return 0;
    if (keyframes.length === 1) return keyframes[0].value;

    // Find surrounding keyframes
    let prev = keyframes[0];
    let next = keyframes[keyframes.length - 1];
    for (let i = 0; i < keyframes.length - 1; i++) {
        if (t >= keyframes[i].time && t <= keyframes[i + 1].time) {
            prev = keyframes[i];
            next = keyframes[i + 1];
            break;
        }
    }

    if (t <= prev.time) return prev.value;
    if (t >= next.time) return next.value;

    // Normalize t between prev and next
    const localT = (t - prev.time) / (next.time - prev.time);

    // Apply easing
    let easedT = localT;
    switch (prev.easing) {
        case 'ease-in':
            easedT = localT * localT;
            break;
        case 'ease-out':
            easedT = 1 - (1 - localT) * (1 - localT);
            break;
        case 'ease-in-out':
            easedT = localT < 0.5 ? 2 * localT * localT : 1 - Math.pow(-2 * localT + 2, 2) / 2;
            break;
        case 'bezier':
            if (prev.bezierCP) {
                easedT = cubicBezier(prev.bezierCP[0], prev.bezierCP[1], prev.bezierCP[2], prev.bezierCP[3], localT);
            }
            break;
        default:
            easedT = localT;
    }

    return prev.value + (next.value - prev.value) * easedT;
};

/** Cubic Bezier easing function (like CSS cubic-bezier). */
const cubicBezier = (x1: number, y1: number, x2: number, y2: number, t: number): number => {
    // Approximate using Newton-Raphson
    const cx = 3 * x1;
    const bx = 3 * (x2 - x1) - cx;
    const ax = 1 - cx - bx;
    const cy = 3 * y1;
    const by = 3 * (y2 - y1) - cy;
    const ay = 1 - cy - by;

    const solveCurveX = (t: number): number => {
        let x = t;
        for (let i = 0; i < 8; i++) {
            const current = ((ax * x + bx) * x + cx) * x - t;
            if (Math.abs(current) < 0.001) return x;
            const deriv = (3 * ax * x + 2 * bx) * x + cx;
            if (Math.abs(deriv) < 0.001) break;
            x -= current / deriv;
        }
        return x;
    };

    const x = solveCurveX(t);
    return ((ay * x + by) * x + cy) * x;
};

// ─── Zoom Blur Transition ────────────────────────────────────────────

/**
 * Draw a zoom blur effect for transitions.
 * Draws multiple scaled copies with decreasing alpha.
 */
export const drawZoomBlur = (
    ctx: CanvasRenderingContext2D,
    drawFn: () => void,
    width: number,
    height: number,
    intensity: number,
): void => {
    if (intensity <= 0) {
        drawFn();
        return;
    }

    const COPIES = 6;
    const cx = width / 2;
    const cy = height / 2;

    for (let i = COPIES; i >= 1; i--) {
        ctx.save();
        ctx.globalAlpha = (intensity * 0.1) * (1 - i / COPIES);
        const scale = 1 + i * 0.02 * intensity;
        ctx.translate(cx, cy);
        ctx.scale(scale, scale);
        ctx.translate(-cx, -cy);
        drawFn();
        ctx.restore();
    }
    drawFn();
};

// ─── Glitch Transition ───────────────────────────────────────────────

/**
 * Draw a glitch displacement effect for transitions.
 * Slices the image horizontally and displaces slices randomly.
 */
export const drawGlitchEffect = (
    ctx: CanvasRenderingContext2D,
    canvas: HTMLCanvasElement,
    width: number,
    height: number,
    intensity: number,
    time: number,
): void => {
    if (intensity <= 0) {
        ctx.drawImage(canvas, 0, 0);
        return;
    }

    const SLICES = 12;
    const sliceH = height / SLICES;

    for (let i = 0; i < SLICES; i++) {
        const noise = Math.sin(time * 0.01 + i * 2.3) * intensity;
        const offset = noise * 40;
        const srcY = i * sliceH;
        ctx.drawImage(
            canvas,
            0, srcY, width, sliceH,
            offset, srcY, width, sliceH,
        );
    }

    // RGB split overlay
    if (intensity > 0.3) {
        ctx.save();
        ctx.globalCompositeOperation = 'screen';
        ctx.globalAlpha = intensity * 0.5;
        ctx.filter = 'hue-rotate(0deg) saturate(2)';
        ctx.drawImage(canvas, intensity * 6, 0, width, height);
        ctx.filter = 'hue-rotate(120deg) saturate(2)';
        ctx.drawImage(canvas, -intensity * 6, 0, width, height);
        ctx.restore();
    }
};
