/**
 * Orthogonal creative axes for batch image variations.
 * Each index gets a concrete, mandatory visual change so results diverge at a glance.
 */

export interface VariationAxis {
  id: string;
  label: string;
  /** Concrete execution instructions the image model must follow */
  instruction: string;
}

export const VARIATION_AXES: VariationAxis[] = [
  {
    id: 'camera_crop',
    label: 'Camera & crop',
    instruction:
      'Change camera height and distance aggressively: try a lower hero angle or a tighter cropped detail vs a wider establishing frame. Different focal length feel (35mm vs 85mm). Do not reuse the reference photo’s exact crop.',
  },
  {
    id: 'lighting',
    label: 'Lighting & mood',
    instruction:
      'Change the lighting scheme completely: soft window daylight vs hard directional studio key vs warm golden rim/backlight. Shadows, contrast, and color temperature must read differently from a default catalog shot.',
  },
  {
    id: 'environment',
    label: 'Environment & surface',
    instruction:
      'Change the setting and surface: clean seamless studio vs lifestyle counter/shelf vs textured natural surface (stone, linen, wood). Background depth and props must clearly differ from a plain pack shot.',
  },
  {
    id: 'composition_style',
    label: 'Composition & styling',
    instruction:
      'Change layout language: centered symmetry with negative space vs off-center rule-of-thirds vs flat-lay / overhead. Adjust prop density (minimal vs styled) while keeping the product readable and on-brand.',
  },
  {
    id: 'editorial_graphic',
    label: 'Editorial treatment',
    instruction:
      'Push a bolder editorial or campaign treatment: higher contrast, more graphic color blocking or atmospheric haze, stronger brand-color accents in the scene — still photorealistic unless the brief asks otherwise.',
  },
  {
    id: 'scale_context',
    label: 'Scale & context',
    instruction:
      'Change how the product relates to the frame: extreme close-up of pack detail vs mid-shot with hands/lifestyle cue vs environmental wide where the product is a clear hero but not filling the entire frame.',
  },
];

/**
 * Builds a hard variation brief for batch generation index `index` (0-based).
 * Axes cycle; after the first full cycle, each take also borrows a secondary axis
 * so later variations keep diverging instead of repeating.
 */
export function buildBatchVariationDirective(index: number, total: number): string {
  if (total <= 1) return '';

  const primary = VARIATION_AXES[index % VARIATION_AXES.length];
  const cycle = Math.floor(index / VARIATION_AXES.length);
  const secondary =
    cycle > 0
      ? VARIATION_AXES[(index + 2 + cycle) % VARIATION_AXES.length]
      : null;

  const lines = [
    `VARIATION BRIEF — ${index + 1} of ${total} (axis: ${primary.label})`,
    'This image is one option in a DIVERGENT exploration set. It MUST look obviously different from the other variations at a glance.',
    'Preserve ONLY: exact product identity, packaging/label accuracy, and brand palette cues.',
    'DO NOT copy the product reference photo’s framing, camera height, lighting, or backdrop. Use references for product truth only.',
    `MANDATORY CHANGE — ${primary.label}: ${primary.instruction}`,
  ];

  if (secondary) {
    lines.push(
      `SECONDARY CHANGE — ${secondary.label}: ${secondary.instruction}`,
    );
  }

  lines.push(
    'If the base prompt conflicts with this brief on camera, light, or setting, follow this VARIATION BRIEF for those axes and keep the rest of the creative intent.',
  );

  return `\n\n${lines.join('\n')}`;
}
