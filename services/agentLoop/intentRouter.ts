/**
 * Intent router — classify user goal into a skill path for the loop planner.
 */
import { looksLikeRecreateIntent } from '../../runtime/recreateLanguage';
import { isSocialReferenceUrl, resolvePromptUrlRoles } from '../promptUrlRoles';
import type { LoopSkillPath } from './types';

export interface IntentClassification {
  skillPath: LoopSkillPath;
  confidence: number;
  reasons: string[];
  /** Reference URL for capture / structure analysis — never the product URL. */
  referenceUrl?: string;
  /** Product URL for research / identity lock — never a social reference. */
  productUrl?: string;
  hasReferenceUploads: boolean;
}

const STATIC_RE =
  /\b(static\s+image|feed\s+post|carousel|single\s+image\s+ad)\b/i;

const OPEN_ENDED_RE =
  /\b(ffmpeg|ffprobe|python|shell|script|inspect|debug|repair|list files|probe)\b/i;

/**
 * Deterministic intent classification (no LLM). Safe for tests + cold start.
 * URL roles are resolved by `resolvePromptUrlRoles`; callers that already know
 * the roles should pass them so no URL is classified twice.
 */
export function classifyIntent(args: {
  prompt: string;
  adFormat?: string;
  referenceUploadCount?: number;
  /** Already-resolved reference URL (form field or launch param). */
  referenceUrl?: string;
  /** Already-resolved product URL (form field or launch param). */
  productUrl?: string;
}): IntentClassification {
  const prompt = (args.prompt || '').trim();
  const reasons: string[] = [];
  const roles = resolvePromptUrlRoles({
    prompt,
    explicitProductUrl: args.productUrl,
    explicitReferenceUrl: args.referenceUrl,
  });
  const productUrl = roles.productUrl;
  // A recreate ask with a non-social spare URL (direct mp4, portfolio page)
  // still needs a reference; the spare is only used when nothing social exists.
  const wantsRecreate = looksLikeRecreateIntent(prompt);
  const referenceUrl = roles.referenceUrl
    || (wantsRecreate ? roles.extraUrls[0] : undefined);
  const hasReferenceUploads = (args.referenceUploadCount || 0) > 0;

  // Social post URLs often imply recreate-from-reference
  const looksLikeSocialRef = isSocialReferenceUrl(referenceUrl);

  if (wantsRecreate || (looksLikeSocialRef && hasReferenceUploads)) {
    reasons.push('Recreate / match-reference language detected');
    if (hasReferenceUploads) reasons.push('Reference uploads present');
    if (looksLikeSocialRef) reasons.push('Social reference URL present');
    return {
      skillPath: 'recreate_reference_video',
      confidence: wantsRecreate ? 0.92 : 0.75,
      reasons,
      referenceUrl,
      productUrl,
      hasReferenceUploads,
    };
  }

  if (hasReferenceUploads && /\b(match|like|similar|same\s+vibe|structure)\b/i.test(prompt)) {
    reasons.push('Uploads + match-structure language');
    return {
      skillPath: 'recreate_reference_video',
      confidence: 0.8,
      reasons,
      referenceUrl,
      productUrl,
      hasReferenceUploads,
    };
  }

  if (
    STATIC_RE.test(prompt)
    || args.adFormat === 'static_image'
    || args.adFormat === 'carousel'
  ) {
    reasons.push('Static / carousel format');
    return {
      skillPath: 'static_or_carousel',
      confidence: 0.85,
      reasons,
      referenceUrl,
      productUrl,
      hasReferenceUploads,
    };
  }

  if (OPEN_ENDED_RE.test(prompt) && prompt.length > 40) {
    reasons.push('Open-ended tool / media ops ask');
    return {
      skillPath: 'open_ended_tools',
      confidence: 0.7,
      reasons,
      referenceUrl,
      productUrl,
      hasReferenceUploads,
    };
  }

  reasons.push('Default production pipeline');
  return {
    skillPath: 'standard_stitched_video',
    confidence: 0.65,
    reasons,
    referenceUrl,
    productUrl,
    hasReferenceUploads,
  };
}

export function isRecreateReferenceIntent(classification: IntentClassification): boolean {
  return classification.skillPath === 'recreate_reference_video';
}
