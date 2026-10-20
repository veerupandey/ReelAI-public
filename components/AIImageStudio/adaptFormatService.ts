import type { ImageGenerationRequest } from '../../types';
import type { AspectRatio, StudioAsset } from './types';
import { buildEditRequest } from './studioService';
import {
  formatAspectRatioLabel,
  getAspectRatioCompositionGuidance,
  resolveAspectRatioOption,
} from './aspectRatioCatalog';

/** Platform sizes users most often need from a single master. */
export const ADAPT_FORMAT_TARGETS: AspectRatio[] = [
  '4:5',
  '1:1',
  '9:16',
  '16:9',
  '1464x600',
  '600x450',
];

/** All batch / toolbar targets (includes current size — caller may still adapt copies). */
export function getBatchAdaptFormatTargets(): AspectRatio[] {
  return [...ADAPT_FORMAT_TARGETS];
}

/**
 * Target ratios offered for Adapt format, excluding the asset's current ratio.
 */
export function getAdaptFormatTargets(current?: AspectRatio | null): AspectRatio[] {
  return ADAPT_FORMAT_TARGETS.filter((ratio) => ratio !== current);
}

/** Short button label, e.g. "A+ Desk" or "4:5". */
export function formatAdaptTargetLabel(target: AspectRatio): string {
  return resolveAspectRatioOption(target).shortLabel;
}

/** Longer label with pixels when known. */
export function formatAdaptTargetDetail(target: AspectRatio): string {
  return formatAspectRatioLabel(target);
}

/**
 * Prompt for Gemini edit/reframe into a new aspect ratio.
 * Source image is the primary reference — identity preserved, composition adapted.
 */
export function buildAdaptFormatPrompt(
  source: StudioAsset,
  target: AspectRatio,
): string {
  const from = source.aspectRatio || 'unknown';
  const prior = source.generationPrompt?.trim();
  const targetLabel = formatAdaptTargetDetail(target);

  return [
    'FORMAT ADAPT — REFRAME (not a simple crop)',
    `Recompose this exact image into a true ${targetLabel} frame.`,
    `Source aspect: ${from}. Target aspect: ${target}.`,
    getAspectRatioCompositionGuidance(target),
    '',
    'HARD RULES:',
    '- Preserve exact product identity, packaging, label art, logo, colors, and materials from the attached source image.',
    '- Keep the same scene, styling, and on-image messaging — only change the canvas / composition for the new format.',
    '- Do NOT stretch, squash, or letterbox the source. Rebuild the composition for the new frame.',
    '- You may extend background / environment / negative space as needed so the new aspect looks intentional.',
    '- Keep lighting, brand mood, and on-image text (if any) consistent with the source; reposition text if needed for legibility.',
    '- Output must fill the full frame at the target aspect with no black bars.',
    '',
    prior
      ? `Original creative intent (preserve spirit, adapt for ${targetLabel}):\n${prior.slice(0, 1200)}`
      : `Adapt the attached source image’s scene and styling for ${targetLabel}.`,
  ].join('\n');
}

/**
 * Edit-mode request that feeds the source as primaryReference and skips prompt QA
 * so the reframe brief is not diluted.
 */
export function buildAdaptFormatRequest(
  source: StudioAsset,
  target: AspectRatio,
): ImageGenerationRequest {
  if (!source.base64) {
    throw new Error('Source image has no exportable data to adapt.');
  }
  const request = buildEditRequest(
    buildAdaptFormatPrompt(source, target),
    target,
    source,
  );
  return {
    ...request,
    skipPromptReview: true,
  };
}
