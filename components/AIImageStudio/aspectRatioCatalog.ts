/**
 * Image Studio aspect / canvas catalog.
 * Presets include social ratios + Amazon A+ pixel targets.
 * Custom sizes use `${width}x${height}` ids (e.g. "1200x628").
 */
import type { AspectRatio } from './types';

/** Gemini imageConfig.aspectRatio values we map studio canvases onto. */
export type GeminiImageAspect =
  | '1:1'
  | '2:3'
  | '3:2'
  | '3:4'
  | '4:3'
  | '4:5'
  | '5:4'
  | '9:16'
  | '16:9'
  | '21:9';

export type AspectRatioGroup = 'social' | 'amazon' | 'custom';

export interface AspectRatioOption {
  id: AspectRatio;
  /** Chip / dropdown short label */
  shortLabel: string;
  /** Full label for menus */
  label: string;
  /** Relative icon box (not necessarily pixels) */
  w: number;
  h: number;
  group: AspectRatioGroup;
  description?: string;
  /** Exact deliverable pixels when known (Amazon A+) */
  targetWidth?: number;
  targetHeight?: number;
  /** Value passed to Gemini imageConfig */
  geminiAspect: GeminiImageAspect;
}

export const ASPECT_RATIO_OPTIONS: AspectRatioOption[] = [
  {
    id: '9:16',
    shortLabel: '9:16',
    label: '9:16 Stories / Reels',
    w: 9,
    h: 16,
    group: 'social',
    geminiAspect: '9:16',
    description: 'Vertical stories & reels',
  },
  {
    id: '4:5',
    shortLabel: '4:5',
    label: '4:5 Feed',
    w: 4,
    h: 5,
    group: 'social',
    geminiAspect: '4:5',
    description: 'Instagram feed portrait',
  },
  {
    id: '1:1',
    shortLabel: '1:1',
    label: '1:1 Square',
    w: 1,
    h: 1,
    group: 'social',
    geminiAspect: '1:1',
    description: 'Square feed',
  },
  {
    id: '16:9',
    shortLabel: '16:9',
    label: '16:9 Landscape',
    w: 16,
    h: 9,
    group: 'social',
    geminiAspect: '16:9',
    description: 'Wide landscape',
  },
  {
    id: '2:3',
    shortLabel: '2:3',
    label: '2:3 Portrait',
    w: 2,
    h: 3,
    group: 'social',
    geminiAspect: '2:3',
    description: 'Tall portrait',
  },
  {
    id: '4:3',
    shortLabel: '4:3',
    label: '4:3 Landscape',
    w: 4,
    h: 3,
    group: 'social',
    geminiAspect: '4:3',
    description: 'Classic landscape',
  },
  {
    id: '21:9',
    shortLabel: '21:9',
    label: '21:9 Ultra-wide',
    w: 21,
    h: 9,
    group: 'social',
    geminiAspect: '21:9',
    description: 'Cinematic banner',
  },
  {
    id: '1464x600',
    shortLabel: 'A+ Desk',
    label: 'Amazon A+ Desktop',
    w: 1464,
    h: 600,
    group: 'amazon',
    geminiAspect: '21:9',
    targetWidth: 1464,
    targetHeight: 600,
    description: 'Amazon A+ desktop · 1464×600 px min',
  },
  {
    id: '600x450',
    shortLabel: 'A+ Mob',
    label: 'Amazon A+ Mobile',
    w: 600,
    h: 450,
    group: 'amazon',
    geminiAspect: '4:3',
    targetWidth: 600,
    targetHeight: 450,
    description: 'Amazon A+ mobile · 600×450 px min',
  },
];

const GEMINI_ASPECTS: Array<{ id: GeminiImageAspect; ratio: number }> = [
  { id: '1:1', ratio: 1 },
  { id: '5:4', ratio: 5 / 4 },
  { id: '4:3', ratio: 4 / 3 },
  { id: '3:2', ratio: 3 / 2 },
  { id: '16:9', ratio: 16 / 9 },
  { id: '21:9', ratio: 21 / 9 },
  { id: '4:5', ratio: 4 / 5 },
  { id: '3:4', ratio: 3 / 4 },
  { id: '2:3', ratio: 2 / 3 },
  { id: '9:16', ratio: 9 / 16 },
];

const PIXEL_SIZE_RE = /^(\d{2,5})x(\d{2,5})$/i;

export function parsePixelAspectId(id: string): { width: number; height: number } | null {
  const m = PIXEL_SIZE_RE.exec((id || '').trim());
  if (!m) return null;
  const width = Number(m[1]);
  const height = Number(m[2]);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 64 || height < 64) {
    return null;
  }
  if (width > 8192 || height > 8192) return null;
  return { width, height };
}

export function makeCustomAspectId(width: number, height: number): AspectRatio {
  const w = Math.round(width);
  const h = Math.round(height);
  return `${w}x${h}`;
}

export function nearestGeminiAspect(width: number, height: number): GeminiImageAspect {
  const ratio = width / height;
  let best: GeminiImageAspect = '1:1';
  let bestDist = Infinity;
  for (const candidate of GEMINI_ASPECTS) {
    const dist = Math.abs(candidate.ratio - ratio);
    if (dist < bestDist) {
      bestDist = dist;
      best = candidate.id;
    }
  }
  return best;
}

export function getAspectRatioOption(id?: string | null): AspectRatioOption | undefined {
  const key = (id || '').trim();
  if (!key) return undefined;
  return ASPECT_RATIO_OPTIONS.find((o) => o.id === key);
}

export function resolveAspectRatioOption(id?: string | null): AspectRatioOption {
  const known = getAspectRatioOption(id);
  if (known) return known;

  const pixels = parsePixelAspectId(id || '');
  if (pixels) {
    const geminiAspect = nearestGeminiAspect(pixels.width, pixels.height);
    return {
      id: makeCustomAspectId(pixels.width, pixels.height),
      shortLabel: `${pixels.width}×${pixels.height}`,
      label: `Custom ${pixels.width}×${pixels.height}`,
      w: pixels.width,
      h: pixels.height,
      group: 'custom',
      geminiAspect,
      targetWidth: pixels.width,
      targetHeight: pixels.height,
      description: `Custom canvas · ${pixels.width}×${pixels.height} px`,
    };
  }

  // Fall back to social default
  return ASPECT_RATIO_OPTIONS[0];
}

/** Value for Gemini `imageConfig.aspectRatio`. */
export function toGeminiImageAspectRatio(id?: string | null): GeminiImageAspect {
  return resolveAspectRatioOption(id).geminiAspect;
}

/** Numeric width/height ratio for conformance checks. */
export function getAspectNumericRatio(id?: string | null): number {
  const opt = resolveAspectRatioOption(id);
  return opt.w / opt.h;
}

/** Human label for chips / Writer context. */
export function formatAspectRatioLabel(id?: string | null): string {
  const opt = resolveAspectRatioOption(id);
  if (opt.targetWidth && opt.targetHeight) {
    return `${opt.shortLabel} · ${opt.targetWidth}×${opt.targetHeight}`;
  }
  return opt.shortLabel;
}

/** Composition guidance injected into Prompt Writer + adapt prompts. */
export function getAspectRatioCompositionGuidance(id?: string | null): string {
  const opt = resolveAspectRatioOption(id);
  switch (opt.id) {
    case '9:16':
      return 'Tall vertical/portrait (9:16 story format). Stack elements top-to-bottom. Leave breathing room for UI overlays.';
    case '4:5':
      return 'Slightly tall portrait (4:5 Instagram feed format). Subject fills most of the frame. Great for product hero shots.';
    case '1:1':
      return 'Square (1:1). Center the subject or use diagonal/radial composition.';
    case '16:9':
      return 'Wide landscape (16:9). Horizontal flow with rule of thirds. Good for cinematic scenes.';
    case '2:3':
      return 'Portrait (2:3). Vertical emphasis with strong subject placement.';
    case '4:3':
      return 'Landscape (4:3). Balanced horizontal composition with comfortable side margins.';
    case '21:9':
      return 'Ultra-wide cinematic banner (21:9). Keep the hero in the center safe zone; use sides for environment.';
    case '1464x600':
      return [
        'Amazon A+ desktop module — compose for a wide horizontal banner.',
        'Target deliverable: at least 1464×600 px (≈2.44:1).',
        'Keep product + headline readable at desktop width; avoid critical detail near extreme left/right edges.',
        'Prefer a clean ecommerce module layout (hero product, benefit text, generous negative space).',
      ].join(' ');
    case '600x450':
      return [
        'Amazon A+ mobile module — compose for a compact 4:3 card.',
        'Target deliverable: at least 600×450 px.',
        'Keep product large and text short; prioritize mobile thumb-zone readability.',
        'Prefer a clean ecommerce module layout suitable for small screens.',
      ].join(' ');
    default:
      if (opt.targetWidth && opt.targetHeight) {
        return [
          `Custom canvas ${opt.targetWidth}×${opt.targetHeight} px (${opt.geminiAspect} generation frame).`,
          'Compose so the final crop/export matches those exact pixel proportions.',
          'Keep critical subject and text inside a safe center margin.',
        ].join(' ');
      }
      return `Compose for ${opt.label} frame.`;
  }
}

/** Optional prompt suffix so generators know exact pixel intent. */
export function aspectRatioPromptSuffix(id?: string | null): string {
  const opt = resolveAspectRatioOption(id);
  if (!opt.targetWidth || !opt.targetHeight) return '';
  return ` Canvas / export target: ${opt.targetWidth}×${opt.targetHeight} pixels (${opt.label}). Compose for that exact frame.`;
}

export function isAmazonAplusAspect(id?: string | null): boolean {
  const opt = resolveAspectRatioOption(id);
  return opt.group === 'amazon';
}
