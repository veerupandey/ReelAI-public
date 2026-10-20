/**
 * Shared photography-realism language for ad-agent stills.
 * Goal: real product shoot / commercial camera look — not AI-glossy CGI.
 */

export const PRODUCT_PHOTO_REALISM_POSITIVES = [
  'real product photography',
  'shot on a real camera',
  'natural imperfect light',
  'tactile materials and surfaces',
  'believable lens depth of field',
  'credible handheld or lifestyle framing',
  'exact packaging readable and grounded in the scene',
  'physically possible action a food or product photographer could shoot in one take',
].join(', ');

export const PRODUCT_PHOTO_REALISM_NEGATIVES = [
  'illustration',
  'CGI',
  '3D render',
  'plastic skin',
  'fake HDR',
  'oversmooth AI look',
  'unreal reflections',
  'stock-catalog sterility',
  'synthetic glow',
  'overprocessed beauty filter',
  'floating foam or cream',
  'cream bridges between hands',
  'levitating liquid',
  'melted or fused hands',
  'extra fingers',
  'impossible physics',
].join(', ');

/** Planner RULES bullet — inject into planScenes / planCarouselSlides. */
export const PRODUCT_PHOTO_REALISM_PLANNER_RULE = `
- PHOTOGRAPHY REALISM: every imagePrompt must read as a real product shoot directed for camera — natural imperfect light, tactile materials, real lens DOF, credible lifestyle or packshot. Ban AI-glossy CGI, illustration, plastic skin, fake HDR, oversmooth skin, unreal reflections, sterile catalog look.
- PHOTOGRAPHABLE ACTIONS ONLY: plan beats a commercial photographer could capture in one still — packshot, whisk in bowl, pour into cup, tin in hand, sip, steam rising. Prefer simple single-action frames over complex multi-object transfers.
- HAND + PHYSICS SAFETY (critical — image models fail here): at most one sharp interacting hand; fingers anatomically correct; soft materials (foam, cream, froth, liquid, powder) must rest in a bowl, cup, whisk, spoon, or on a surface — NEVER stretched between hands, floating, bridging, levitating, or defying gravity. Avoid dual-hand foam/cream manipulation and mid-air dollops.
- If a ritual beat needs texture (matcha froth, latte foam), show it IN the vessel under natural light — not held aloft or pulled like taffy.
`.trim().split('\n').map((l) => l.trim()).filter(Boolean).join('\n');

/**
 * Appended to every generateImages call after product lock/composite rules.
 */
export function appendProductPhotoRealism(imagePrompt: string): string {
  const base = (imagePrompt || '').trim();
  if (!base) {
    return `PHOTOGRAPHY REALISM: ${PRODUCT_PHOTO_REALISM_POSITIVES}. Avoid: ${PRODUCT_PHOTO_REALISM_NEGATIVES}.`;
  }
  if (/\bPHOTOGRAPHY REALISM\b/i.test(base)) return base;
  return `${base}\n\nPHOTOGRAPHY REALISM: ${PRODUCT_PHOTO_REALISM_POSITIVES}. Avoid: ${PRODUCT_PHOTO_REALISM_NEGATIVES}.`;
}

/** HARD RULES lines for reviewAndRefineImagePrompt. */
export const PRODUCT_PHOTO_REALISM_REVIEW_RULES = `
        - Force a real product photography / real camera shoot look unless the prompt explicitly requests illustration or CGI.
        - Prefer natural imperfect light, tactile materials, believable lens DOF, and grounded product presence.
        - Strip or rewrite cues that push AI-glossy CGI: plastic skin, fake HDR, oversmooth beauty filter, unreal reflections, sterile catalog sterility, synthetic glow.
        - PHYSICS / HANDS: rewrite any prompt that implies floating foam/cream, cream bridges between hands, levitating liquid, melted/fused hands, or extra fingers. Soft textures must sit in a vessel or on a surface; prefer one clear hand interacting with a solid prop (tin, whisk, cup).
        - Keep exact packaging/product identity instructions intact.`;
