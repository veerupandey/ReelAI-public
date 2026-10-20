import type {
  BrandKnowledge,
  CreativeConcept,
  OutputIntent,
  ProductTruth,
  SocialPostDraft,
  TrendResearchResult,
} from './types';

export interface CreativeProductionContext {
  userDirection: string;
  productTruth?: ProductTruth;
  brandKnowledge?: BrandKnowledge;
  trendResearch?: TrendResearchResult;
  /** @deprecated Use selectedConcept instead */
  activeDirection?: import('./types').CreativeDirection;
  selectedConcept?: CreativeConcept;
  socialPostDraft?: SocialPostDraft;
  outputIntent?: OutputIntent;
  aspectRatio?: string;
  /** True when userDirection is already a complete, enriched prompt from the Prompt Writer */
  isPromptEnriched?: boolean;
}

function getAspectRatioGuidance(ratio: string): string[] {
  switch (ratio) {
    case '9:16':
      return [
        'This is a tall vertical/portrait frame (9:16 story format).',
        'Compose with strong vertical flow — stack elements top-to-bottom.',
        'Keep the subject centered or slightly above center; leave breathing room at top and bottom for UI overlays.',
        'Avoid wide panoramic compositions that would be cropped or letter-boxed.',
      ];
    case '4:5':
      return [
        'This is a slightly tall portrait frame (4:5 Instagram feed format).',
        'Compose with the subject filling most of the frame; slight vertical emphasis.',
        'Works well for product hero shots, tight portraits, and food photography.',
      ];
    case '1:1':
      return [
        'This is a square frame (1:1).',
        'Center the subject or use diagonal/radial composition.',
        'Equal weight in all directions — avoid compositions that feel cropped on any side.',
      ];
    case '16:9':
      return [
        'This is a wide landscape frame (16:9 widescreen).',
        'Compose with horizontal flow — use the rule of thirds along the width.',
        'Good for cinematic scenes, wide establishing shots, and side-by-side comparisons.',
        'Avoid tall/vertical subjects that would leave empty space on the sides.',
      ];
    default:
      return [`Compose the image to fill a ${ratio} frame naturally.`];
  }
}

const section = (title: string, lines: unknown[]): string => {
  const content = lines.filter(
    (line): line is string => typeof line === 'string' && line.trim().length > 0,
  );
  return content.length > 0 ? `${title}\n${content.join('\n')}` : '';
};

/** Compact brand aesthetics block for Enhance / Writer / generation prompts. */
export function buildBrandAestheticsBrief(brandKnowledge?: BrandKnowledge | null): string {
  if (!brandKnowledge) return '';
  const accepted = <T,>(values: Array<{ value: T; status: string }>) =>
    values.filter((v) => v.status !== 'rejected').map((v) => v.value);

  const lines = [
    brandKnowledge.brandName.status !== 'rejected'
      ? `Brand: ${brandKnowledge.brandName.value}`
      : undefined,
    accepted(brandKnowledge.toneAttributes).length > 0
      ? `Tone: ${accepted(brandKnowledge.toneAttributes).join(', ')}`
      : undefined,
    accepted(brandKnowledge.visualPrinciples).length > 0
      ? `Visual principles: ${accepted(brandKnowledge.visualPrinciples).join(', ')}`
      : undefined,
    accepted(brandKnowledge.colors).length > 0
      ? `Palette: ${accepted(brandKnowledge.colors).join(', ')}`
      : undefined,
    accepted(brandKnowledge.approvedLanguage).length > 0
      ? `Approved language: ${accepted(brandKnowledge.approvedLanguage).join('; ')}`
      : undefined,
    accepted(brandKnowledge.fonts).length > 0
      ? `Typography: ${accepted(brandKnowledge.fonts)
          .map((f) => `${f.family} (${f.role})`)
          .join(', ')}`
      : undefined,
    accepted(brandKnowledge.logoRules).length > 0
      ? `Logo rules: ${accepted(brandKnowledge.logoRules).join('; ')}`
      : undefined,
    accepted(brandKnowledge.prohibitedLanguage).length > 0
      ? `Avoid language: ${accepted(brandKnowledge.prohibitedLanguage).join('; ')}`
      : undefined,
    accepted(brandKnowledge.imageStyle.lighting).length > 0
      ? `Lighting: ${accepted(brandKnowledge.imageStyle.lighting).join(', ')}`
      : undefined,
    accepted(brandKnowledge.imageStyle.composition).length > 0
      ? `Composition: ${accepted(brandKnowledge.imageStyle.composition).join(', ')}`
      : undefined,
    accepted(brandKnowledge.imageStyle.backgrounds).length > 0
      ? `Backgrounds: ${accepted(brandKnowledge.imageStyle.backgrounds).join(', ')}`
      : undefined,
    accepted(brandKnowledge.imageStyle.textures).length > 0
      ? `Textures: ${accepted(brandKnowledge.imageStyle.textures).join(', ')}`
      : undefined,
  ].filter((line): line is string => Boolean(line));

  return lines.join('\n');
}

function buildSocialPostOutputSection(socialPostDraft: SocialPostDraft | undefined): string {
  const plan = socialPostDraft?.artDirectionPlan;

  // When art direction plan exists, respect its text decisions
  if (plan) {
    if (plan.textDecision === 'none') {
      return section('TEXT CONTROL', [
        'DO NOT include any text, typography, letters, words, or watermarks in the generated image.',
        'This is a text-free design that relies solely on the visual composition.',
      ]);
    }

    // Plan has visible text — render only the validated strings from the plan
    const textLines = plan.visibleText.map(
      (entry) => `- ${entry.role}: "${entry.content}" (placement: ${entry.placement}, max: ${entry.maxChars} chars)`,
    );
    return section('APPROVED ON-IMAGE TEXT (use ONLY these exact strings)', [
      ...textLines,
      'Do not render captions, hashtags, or other publish-only copy inside the image, and do not add any text beyond the approved strings above.',
    ]);
  }

  // No art direction plan — preserve existing behavior (backward compat)
  return section('SOCIAL POST OUTPUT', [
    'Compose for a social post with readable hierarchy and platform-safe text placement.',
    socialPostDraft
      ? `Render this exact on-image copy as clean, legible typography inside the platform-safe zones: headline "${socialPostDraft.copy.headline}"${socialPostDraft.copy.supportingText ? `, supporting text "${socialPostDraft.copy.supportingText}"` : ''}${socialPostDraft.copy.callToAction ? `, call to action "${socialPostDraft.copy.callToAction}"` : ''}.`
      : 'Leave clear negative space where a text overlay can be added later.',
    socialPostDraft?.typography.headingFont
      ? `Set the headline in a ${socialPostDraft.typography.headingFont.family}-style typeface.`
      : '',
    'Do not render captions, hashtags, or other publish-only copy inside the image, and do not add any text beyond the copy specified above.',
  ]);
}

export function buildCreativeProductionPrompt(context: CreativeProductionContext): string {
  const { productTruth, brandKnowledge, trendResearch, selectedConcept, socialPostDraft, isPromptEnriched } = context;

  // If the prompt was written by the Prompt Writer, it's already a complete, detailed
  // prompt that includes brand context, product guidance, and creative direction.
  // Wrapping it again with product truth, brand guidance, and trends would dilute the
  // writer's carefully crafted prompt with redundant context. Just add aspect ratio.
  if (isPromptEnriched) {
    const enrichedParts = [
      context.userDirection,
      context.aspectRatio && section('OUTPUT FORMAT — CRITICAL', [
        `Aspect ratio: ${context.aspectRatio}`,
        ...getAspectRatioGuidance(context.aspectRatio),
      ]),
    ];
    return enrichedParts.filter(Boolean).join('\n\n');
  }

  if (!productTruth && !brandKnowledge && !trendResearch && !selectedConcept && !socialPostDraft && context.outputIntent !== 'social_post') {
    return context.userDirection;
  }

  // For social posts with a generation brief, the brief is self-contained
  // (includes grounding, art direction, layout, brand, concept, text control).
  // Only add the text control output section and aspect ratio guidance on top.
  if (context.outputIntent === 'social_post' && socialPostDraft?.generationBrief) {
    const platform = socialPostDraft.platform.replace('_', ' ');
    const socialParts = [
      section('SOCIAL MEDIA IMAGE GENERATION — THIS IS A SOCIAL POST, NOT A CONCEPT IMAGE', [
        `Generate a scroll-stopping ${platform} post image optimized for mobile feeds.`,
        `This should feel like a polished, published social media post — not a raw product photo or concept render.`,
        `Platform: ${platform} | Objective: ${socialPostDraft.objective} | Aspect ratio: ${socialPostDraft.aspectRatio}`,
      ]),
      section('SOCIAL POST PRODUCTION SPECIFICATION', [
        socialPostDraft.generationBrief,
      ]),
      productTruth && section('PRODUCT TRUTH - MUST NOT BE CONTRADICTED', [
        `Product: ${productTruth.productName}`,
        ...productTruth.preservationRules.map((rule) => `Preserve: ${rule}`),
        ...productTruth.verifiedFacts.map((fact) => `Verified fact: ${fact}`),
      ]),
      buildSocialPostOutputSection(socialPostDraft),
      context.aspectRatio && section('OUTPUT FORMAT — CRITICAL', [
        `Aspect ratio: ${context.aspectRatio}`,
        ...getAspectRatioGuidance(context.aspectRatio),
      ]),
    ];
    return socialParts.filter(Boolean).join('\n\n');
  }

  const parts = [
    productTruth && section('PRODUCT TRUTH - MUST NOT BE CONTRADICTED', [
      `Product: ${productTruth.productName}`,
      ...productTruth.preservationRules.map((rule) => `Preserve: ${rule}`),
      ...productTruth.verifiedFacts.map((fact) => `Verified fact: ${fact}`),
      ...productTruth.userCorrections.map((correction) => `User correction: ${correction}`),
    ]),
    section('USER DIRECTION - PRIMARY CREATIVE INSTRUCTION', [context.userDirection]),
    socialPostDraft?.generationBrief && section('SOCIAL POST PRODUCTION SPECIFICATION', [
      socialPostDraft.generationBrief,
    ]),
    selectedConcept && section('SELECTED CREATIVE CONCEPT', [
      `Title: ${selectedConcept.title}`,
      `Idea: ${selectedConcept.oneLineIdea}`,
      `Visual: ${selectedConcept.visualDirection}`,
      selectedConcept.hook && `Hook: ${selectedConcept.hook}`,
      selectedConcept.productTruthNotes.length > 0 && `Notes: ${selectedConcept.productTruthNotes.join('; ')}`,
    ]),
    socialPostDraft && section('SOCIAL POST SPECIFICATION', [
      `Platform: ${socialPostDraft.platform}`,
      `Objective: ${socialPostDraft.objective}`,
      `Headline: ${socialPostDraft.copy.headline}`,
      socialPostDraft.copy.supportingText && `Supporting: ${socialPostDraft.copy.supportingText}`,
      `Layout: ${socialPostDraft.layout.templateId}`,
    ]),
    brandKnowledge &&
      (() => {
        const brief = buildBrandAestheticsBrief(brandKnowledge);
        return brief ? section('BRAND GUIDANCE', brief.split('\n')) : '';
      })(),
    trendResearch && section('ADVISORY TREND EVIDENCE - USE ONLY WHEN COMPATIBLE', [
      `Research query: ${trendResearch.query}`,
      ...trendResearch.insights.map((insight) => `${insight.title}: ${insight.description}`),
    ]),
    context.outputIntent === 'social_post'
      ? buildSocialPostOutputSection(socialPostDraft)
      : '',
    context.aspectRatio && section('OUTPUT FORMAT — CRITICAL', [
      `Aspect ratio: ${context.aspectRatio}`,
      ...getAspectRatioGuidance(context.aspectRatio),
    ]),
  ];

  return parts.filter(Boolean).join('\n\n');
}
