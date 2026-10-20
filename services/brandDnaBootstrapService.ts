/**
 * Bootstrap Brand DNA from website research so Agency + Studio share one brand brain.
 */

import type { Brand } from '../types/brand';
import { researchBrand } from '../components/AIImageStudio/brandKnowledgeService';
import { mergeBrandKnowledgeIntoBrandDNA } from './brandKnowledgeAdapter';
import { getBrand, updateBrandDNA, updateBrandStatus } from './brandService';

export type BrandDnaBootstrapProgress = {
  stage: string;
  message: string;
};

export const BRIEF_ONLY_WEBSITE = 'https://brief.local';
export const BRIEF_ONLY_BRAND_NAME = 'Brief-only campaign';

/** Brands created via "Skip — brief-only" so product import still has a Brand id. */
export function isBriefOnlyBrand(brand: Pick<Brand, 'websiteUrl' | 'name'> | null | undefined): boolean {
  if (!brand) return false;
  const url = (brand.websiteUrl || '').trim().toLowerCase();
  if (url.includes('brief.local')) return true;
  return brand.name === BRIEF_ONLY_BRAND_NAME;
}

/** True when the website looks worth sending to brand research. */
export function isResearchableBrandWebsite(websiteUrl?: string | null): boolean {
  const raw = (websiteUrl || '').trim();
  if (!raw) return false;
  try {
    const withProtocol =
      raw.startsWith('http://') || raw.startsWith('https://') ? raw : `https://${raw}`;
    const host = new URL(withProtocol).hostname.toLowerCase();
    if (
      !host ||
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === 'brief.local' ||
      host.endsWith('.local')
    ) {
      return false;
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Research brand website → merge into BrandDNA → persist via brandService.
 * Returns the updated Brand, or null if brand id is missing / research fails hard.
 */
export async function bootstrapBrandDnaFromResearch(
  brand: Brand,
  onProgress?: (progress: BrandDnaBootstrapProgress) => void,
): Promise<Brand | null> {
  if (!brand.id) return null;
  if (!isResearchableBrandWebsite(brand.websiteUrl)) {
    return getBrand(brand.id) ?? brand;
  }

  updateBrandStatus(brand.id, 'researching');
  onProgress?.({ stage: 'researching', message: 'Researching brand DNA…' });

  try {
    const result = await researchBrand(
      { sourceUrls: [brand.websiteUrl] },
      (p) => onProgress?.({ stage: p.stage, message: p.message }),
    );

    const latest = getBrand(brand.id) ?? brand;
    const merged = mergeBrandKnowledgeIntoBrandDNA(latest.dna ?? null, result.knowledge);
    const updated = updateBrandDNA(brand.id, merged);
    onProgress?.({ stage: 'ready', message: 'Brand DNA ready' });
    return updated ?? getBrand(brand.id);
  } catch (error) {
    // Leave brand usable even if research fails — restore prior status when possible.
    const latest = getBrand(brand.id);
    if (latest?.dna) {
      updateBrandStatus(brand.id, 'ready');
    } else {
      updateBrandStatus(brand.id, 'new');
    }
    onProgress?.({
      stage: 'error',
      message: error instanceof Error ? error.message : 'Brand DNA research failed',
    });
    return getBrand(brand.id);
  }
}

/** True when brand already has enough DNA to seed BrandKnowledge usefully. */
export function brandHasUsableDna(brand: Brand | null | undefined): boolean {
  if (!brand?.dna) return false;
  const palette = brand.dna.colors?.palette?.filter(Boolean) ?? [];
  const aesthetic = brand.dna.aesthetic?.filter(Boolean) ?? [];
  return palette.length > 0 || aesthetic.length > 0 || Boolean(brand.dna.visualSignature);
}
