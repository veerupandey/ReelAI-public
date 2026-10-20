/**
 * Lightweight intent parser for Image Studio Enhance.
 * Classifies the user's prompt so enhancement can bias structure / look without a second model call.
 */

import type { CreativeRoute, OutputIntent } from './types';

export type StudioEnhanceIntent =
  | 'recreate_reference'
  | 'carousel_slide'
  | 'product_hero'
  | 'lifestyle'
  | 'social_post'
  | 'edit_existing'
  | 'composite'
  | 'generic';

export interface StudioEnhanceIntentResult {
  intent: StudioEnhanceIntent;
  rationale: string;
  /** Short directives injected into the enhance system prompt */
  directives: string[];
}

export function parseStudioEnhanceIntent(input: {
  prompt: string;
  creativeRoute: CreativeRoute;
  outputIntent?: OutputIntent;
  referenceRoles?: string[];
}): StudioEnhanceIntentResult {
  const text = (input.prompt || '').trim();
  const lower = text.toLowerCase();
  const roles = input.referenceRoles || [];

  if (input.outputIntent === 'social_post') {
    return {
      intent: 'social_post',
      rationale: 'Output intent is social_post',
      directives: [
        'Optimize for a scroll-stopping social feed/story still with clear hierarchy.',
        'Preserve brand palette and on-image text only when the prompt already specifies exact copy.',
      ],
    };
  }

  if (input.creativeRoute === 'edit' || input.creativeRoute === 'ai_upgrade') {
    return {
      intent: 'edit_existing',
      rationale: `Creative route is ${input.creativeRoute}`,
      directives: [
        'Treat the attached base image as ground truth for composition and product identity.',
        'Describe upgrades (light, grade, cleanup) without inventing a new product or layout.',
      ],
    };
  }

  if (input.creativeRoute === 'composite' || roles.includes('include')) {
    return {
      intent: 'composite',
      rationale: 'Composite route or include-role references',
      directives: [
        'Describe how attached reference elements should be combined in one coherent scene.',
        'Keep product identity locked; invent only supporting environment around the refs.',
      ],
    };
  }

  if (
    /\b(recreate|remake|replicate|same structure|same layout|reference carousel|reference post)\b/i.test(
      text,
    )
  ) {
    return {
      intent: 'recreate_reference',
      rationale: 'Prompt asks to recreate / remake a reference',
      directives: [
        'Preserve educational structure, layout zones, and pacing from the reference description.',
        'Adapt look, copy, and brand treatment — do not clone competitor logos or packaging.',
      ],
    };
  }

  if (/\b(carousel|slide\s*\d|slide\b|swipe)\b/i.test(text)) {
    return {
      intent: 'carousel_slide',
      rationale: 'Prompt mentions carousel / slide',
      directives: [
        'Compose as one self-contained carousel slide with clear text hierarchy and safe margins.',
        'Keep visual system consistent with a multi-slide set (same palette, type, grid).',
      ],
    };
  }

  if (
    /\b(lifestyle|in use|ritual|morning|kitchen|hands?|pour|whisk|sip)\b/i.test(lower) ||
    roles.includes('style')
  ) {
    return {
      intent: 'lifestyle',
      rationale: 'Lifestyle cues in prompt or style references',
      directives: [
        'Bias toward authentic in-context lifestyle photography with natural light and tactile materials.',
        'Product should feel placed in a real moment, not a sterile catalog void.',
      ],
    };
  }

  if (
    /\b(hero|packshot|pack shot|product shot|on white|studio)\b/i.test(lower) ||
    roles.every((r) => r === 'product') && roles.length > 0
  ) {
    return {
      intent: 'product_hero',
      rationale: 'Hero / packshot cues or product-only locks',
      directives: [
        'Make the product the undeniable hero with premium lighting and readable packaging.',
        'Keep background supportive and on-brand; do not invent competing products.',
      ],
    };
  }

  return {
    intent: 'generic',
    rationale: 'No strong specialty cues',
    directives: [
      'Expand the user prompt into a production-ready shot brief while preserving their intent.',
      'Prefer brand-aligned aesthetics when brand guidance is provided.',
    ],
  };
}
