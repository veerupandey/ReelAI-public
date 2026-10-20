import { describe, expect, it } from 'vitest';
import {
  buildPreliminaryProductTruth,
  isFilenameLikeProductName,
} from '../../components/AIImageStudio/productTruthService';
import type { StudioAsset } from '../../components/AIImageStudio/types';

function makeAsset(name: string): StudioAsset {
  return {
    id: 'asset-1',
    name,
    description: '',
    base64: 'abc',
    mimeType: 'image/png',
    width: 1080,
    height: 1350,
    source: 'upload',
    createdAt: new Date().toISOString(),
  };
}

describe('productTruthService product naming', () => {
  it('recognizes upload filenames and slugs as non-product labels', () => {
    expect(isFilenameLikeProductName('editorial-uji-roasted-matcha.jpg')).toBe(true);
    expect(isFilenameLikeProductName('editorial-uji-roasted-matcha')).toBe(true);
    expect(isFilenameLikeProductName('Uji Roasted Matcha')).toBe(false);
  });

  it('never promotes an upload filename into Product Truth', () => {
    const truth = buildPreliminaryProductTruth([
      makeAsset('editorial-uji-roasted-matcha.jpg'),
    ]);

    expect(truth.productName).toBe('Unknown product');
    expect(truth.verifiedFacts.join(' ')).not.toContain('.jpg');
    expect(truth.preservationRules.join(' ')).not.toContain('.jpg');
  });

  it('prefers a real imported product name over the asset filename', () => {
    const truth = buildPreliminaryProductTruth(
      [makeAsset('editorial-uji-roasted-matcha.jpg')],
      { productName: 'Kageha Uji Roasted Matcha' },
    );

    expect(truth.productName).toBe('Kageha Uji Roasted Matcha');
    expect(truth.verifiedFacts).toContain('Product name: Kageha Uji Roasted Matcha');
  });
});
