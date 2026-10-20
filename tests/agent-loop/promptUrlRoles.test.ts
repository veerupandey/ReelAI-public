import { describe, expect, it } from 'vitest';
import {
  extractHttpUrls,
  isSocialReferenceUrl,
  missingProductIdentity,
  resolvePromptUrlRoles,
  urlHostLabel,
} from '../../services/promptUrlRoles';

const IG = 'https://www.instagram.com/reel/DK7xyz/';
const SHOP = 'https://kageha.ca/products/matcha-whisk';

describe('resolvePromptUrlRoles', () => {
  it('assigns roles by host, not by order — reference first', () => {
    const roles = resolvePromptUrlRoles({
      prompt: `Recreate this reel ${IG} for my product ${SHOP}`,
    });
    expect(roles.productUrl).toBe(SHOP);
    expect(roles.referenceUrl).toBe(IG);
  });

  it('assigns roles by host, not by order — product first', () => {
    const roles = resolvePromptUrlRoles({
      prompt: `Make an ad for ${SHOP} matching the pacing of ${IG}`,
    });
    expect(roles.productUrl).toBe(SHOP);
    expect(roles.referenceUrl).toBe(IG);
  });

  it('never assigns the same URL to both roles', () => {
    const roles = resolvePromptUrlRoles({ prompt: `Recreate ${IG}` });
    expect(roles.referenceUrl).toBe(IG);
    expect(roles.productUrl).toBeUndefined();
  });

  it('treats a social link in the product field as a reference', () => {
    const roles = resolvePromptUrlRoles({ explicitProductUrl: IG, prompt: '' });
    expect(roles.productUrl).toBeUndefined();
    expect(roles.referenceUrl).toBe(IG);
    expect(roles.reasons.join(' ')).toMatch(/social/i);
  });

  it('lets explicit params win over prose', () => {
    const other = 'https://other-shop.com/products/thing';
    const roles = resolvePromptUrlRoles({
      prompt: `Look at ${other} and ${IG}`,
      explicitProductUrl: SHOP,
    });
    expect(roles.productUrl).toBe(SHOP);
    expect(roles.extraUrls).toContain(other);
  });

  it('prefers a product detail page over a bare domain', () => {
    const roles = resolvePromptUrlRoles({
      prompt: `Brand site https://kageha.ca and the item ${SHOP}`,
    });
    expect(roles.productUrl).toBe(SHOP);
  });

  it('strips trailing punctuation from prose URLs', () => {
    const roles = resolvePromptUrlRoles({ prompt: `Ad for ${SHOP}, please.` });
    expect(roles.productUrl).toBe(SHOP);
  });
});

describe('missingProductIdentity', () => {
  it('blocks a recreate run that only has a social reference', () => {
    const roles = resolvePromptUrlRoles({ prompt: `Recreate ${IG} for us` });
    expect(missingProductIdentity(roles, { hasPackshot: false })).toBe(true);
  });

  it('allows a packshot to stand in for a product URL', () => {
    const roles = resolvePromptUrlRoles({ prompt: `Recreate ${IG} for us`, hasPackshot: true });
    expect(missingProductIdentity(roles, { hasPackshot: true })).toBe(false);
  });

  it('allows a run with a real product URL', () => {
    const roles = resolvePromptUrlRoles({ prompt: `Ad for ${SHOP}` });
    expect(missingProductIdentity(roles, { hasPackshot: false })).toBe(false);
  });
});

describe('url helpers', () => {
  it('detects social hosts', () => {
    expect(isSocialReferenceUrl(IG)).toBe(true);
    expect(isSocialReferenceUrl('https://vt.tiktok.com/ZS123/')).toBe(true);
    expect(isSocialReferenceUrl(SHOP)).toBe(false);
    expect(isSocialReferenceUrl(undefined)).toBe(false);
  });

  it('extracts and de-duplicates URLs', () => {
    expect(extractHttpUrls(`${SHOP} and again ${SHOP} plus ${IG}`)).toEqual([SHOP, IG]);
    expect(extractHttpUrls('no links here')).toEqual([]);
  });

  it('labels hosts for step lines', () => {
    expect(urlHostLabel(SHOP)).toBe('kageha.ca');
    expect(urlHostLabel('upload://product')).toBe('uploaded packshot');
  });
});
