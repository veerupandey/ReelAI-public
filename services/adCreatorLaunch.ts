/**
 * Pure helpers for Ad Creator Hub → Console launch (P1 audit).
 * Keeps Direction (human) separate from Locked brief (researcher).
 */

import { clampAdAgentDurationSec } from '../runtime/adAgentOptions';
import { resolvePromptUrlRoles } from './promptUrlRoles';

export type AdCreatorResearchSeedLike = {
  creativeBrief?: string;
  productTitle?: string;
  productFacts?: string[];
  productBase64?: string;
  productMimeType?: string;
  selectedConceptTitle?: string;
};

export type AdCreatorLaunchInput = {
  formValues: Record<string, string | number | boolean>;
  direction: string;
  researchSeed: AdCreatorResearchSeedLike | null;
  productPackshot: { base64: string; mimeType: string; name: string } | null;
  referenceUploads?: unknown[];
};

/**
 * Build launch params without overwriting user Direction with the research brief.
 * creativeBrief = locked research brief if present, else Direction.
 * userDirection = always the human Direction text when non-empty.
 */
export function buildAdCreatorLaunchParams(input: AdCreatorLaunchInput): Record<string, unknown> {
  const direction = input.direction.trim();
  const lockedBrief = input.researchSeed?.creativeBrief?.trim() || '';
  const heroFromPackshot = Boolean(input.productPackshot?.base64);
  const heroFromResearch = Boolean(input.researchSeed?.productBase64);
  const productBase64 = heroFromPackshot
    ? input.productPackshot!.base64
    : input.researchSeed?.productBase64;
  const productMimeType = heroFromPackshot
    ? input.productPackshot!.mimeType
    : (input.researchSeed?.productMimeType || 'image/png');
  const productFacts = input.researchSeed?.productFacts || [];
  const hasCompleteResearchSeed = Boolean(productBase64 && productFacts.length > 0);
  // Resolve roles here so the console and agent never re-parse prose for URLs.
  const urlRoles = resolvePromptUrlRoles({
    prompt: direction,
    explicitProductUrl: String(input.formValues.productUrl || ''),
    explicitReferenceUrl: String(input.formValues.referenceUrl || ''),
    hasPackshot: Boolean(productBase64),
  });

  const params: Record<string, unknown> = {
    ...input.formValues,
    durationSec: clampAdAgentDurationSec(input.formValues.durationSec ?? 30),
    autoStart: true,
    hubLaunch: true,
  };

  if (input.referenceUploads?.length) params.referenceUploads = input.referenceUploads;

  if (lockedBrief) params.creativeBrief = lockedBrief;
  else if (direction) params.creativeBrief = direction;

  if (direction) params.userDirection = direction;

  if (input.researchSeed?.selectedConceptTitle) {
    params.selectedConceptTitle = input.researchSeed.selectedConceptTitle;
  }
  if (productFacts.length) params.productFacts = productFacts;

  if (heroFromPackshot && input.productPackshot) {
    params.productBase64 = productBase64;
    params.productMimeType = productMimeType;
    params.productTitle = input.productPackshot.name.replace(/\.[^.]+$/, '') || 'Uploaded product';
    params.productImageSource = 'upload';
  } else if (heroFromResearch) {
    params.productBase64 = productBase64;
    params.productMimeType = productMimeType;
    params.productTitle = input.researchSeed?.productTitle || 'Researched product';
    params.productImageSource = 'research';
  }

  if (input.researchSeed?.productTitle && !params.productTitle) {
    params.productTitle = input.researchSeed.productTitle;
  }

  if (hasCompleteResearchSeed) {
    params.skipResearch = true;
    params.skipBrandAndTrends = true;
    params.source = 'product_upload';
  }

  // URL roles win over the raw form copy — a social link in the product field
  // must not travel as product identity.
  if (urlRoles.productUrl) params.productUrl = urlRoles.productUrl;
  else delete params.productUrl;
  if (urlRoles.referenceUrl) params.referenceUrl = urlRoles.referenceUrl;
  else delete params.referenceUrl;

  return params;
}
