import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { render, screen, fireEvent, within } from '@testing-library/react';
import AgencyImageStudioPanel from '../../components/AIImageStudio/AgencyImageStudioPanel';
import type { BrandAsset, ProductContext } from '../../types/brand';

vi.mock('../../components/AIImageStudio/brandComplianceService', () => ({
  evaluateBrandCompliance: vi.fn(async () => ({
    score: 90,
    status: 'pass',
    summary: 'Looks on-brand',
    checks: [],
    evaluatedAt: new Date().toISOString(),
  })),
}));

vi.mock('../../components/AIImageStudio/exportPackService', () => ({
  downloadStudioExportPack: vi.fn(async () => undefined),
}));

vi.mock('../../services/brandService', () => ({
  updateBrandDNA: vi.fn(),
}));

function makeAsset(id: string, overrides: Partial<BrandAsset> = {}): BrandAsset {
  return {
    id,
    type: 'product',
    base64: 'YWJj',
    mimeType: 'image/png',
    description: `Asset ${id}`,
    semanticDescription: `Semantic ${id}`,
    sourceProductTitle: 'Glow Serum',
    verdict: 'use_as_is',
    ...overrides,
  };
}

const lockedProduct: ProductContext = {
  productId: 'p1',
  productTitle: 'Glow Serum',
  productUrl: 'https://example.com/glow',
  brandName: 'Glow Co',
  productAssets: [makeAsset('a1'), makeAsset('a2')],
  productFacts: [],
  allowedClaims: [],
  platform: 'instagram_feed',
  durationSec: 15,
};

const baseProps = {
  lockedProduct,
  brand: null as null,
  excludedAssetIds: [] as string[],
  selectedAssetId: null as string | null,
  setSelectedAssetId: vi.fn(),
  onToggleAssetExcluded: vi.fn(),
  toAssetPreviewUrl: (asset?: BrandAsset) =>
    asset?.base64 ? `data:${asset.mimeType};base64,${asset.base64}` : asset?.previewUrl,
  onGenerateImage: vi.fn(),
  isGenerating: false,
  onEnhancePrompt: vi.fn(async (p: string) => p),
  isEnhancing: false,
  onUploadImage: vi.fn(),
  onBack: vi.fn(),
  onNext: vi.fn(),
};

describe('AgencyImageStudioPanel', () => {
  it('renders modern panel and advances to storyboard when usable assets exist', () => {
    const onNext = vi.fn();

    render(<AgencyImageStudioPanel {...baseProps} onNext={onNext} />);

    expect(screen.getByTestId('agency-image-studio-panel')).toBeTruthy();
    expect(screen.getByRole('heading', { name: /Image Studio/i })).toBeTruthy();
    expect(screen.getAllByText(/Glow Serum/i).length).toBeGreaterThan(0);

    fireEvent.click(screen.getByRole('button', { name: /Build Storyboard/i }));
    expect(onNext).toHaveBeenCalledTimes(1);
  });

  it('disables storyboard when all assets are excluded', () => {
    render(
      <AgencyImageStudioPanel
        {...baseProps}
        excludedAssetIds={['a1', 'a2']}
      />,
    );

    expect(
      (screen.getByRole('button', { name: /Build Storyboard/i }) as HTMLButtonElement).disabled,
    ).toBe(true);
  });

  it('shows previewUrl-only assets in the gallery', () => {
    const previewOnly: ProductContext = {
      ...lockedProduct,
      productAssets: [
        makeAsset('remote-1', {
          base64: '',
          previewUrl: 'https://cdn.example.com/product.jpg',
          sourceProductTitle: 'Remote Packshot',
        }),
      ],
    };

    render(<AgencyImageStudioPanel {...baseProps} lockedProduct={previewOnly} />);

    const gallery = screen.getByRole('grid', { name: /Asset gallery/i });
    const img = within(gallery).getByRole('img');
    expect(img.getAttribute('src')).toBe('https://cdn.example.com/product.jpg');
  });

  it('excludes assets from the card action instead of a button row', () => {
    const onToggleAssetExcluded = vi.fn();
    render(
      <AgencyImageStudioPanel
        {...baseProps}
        onToggleAssetExcluded={onToggleAssetExcluded}
      />,
    );

    const gallery = screen.getByRole('grid', { name: /Asset gallery/i });
    const excludeBtns = within(gallery).getAllByRole('button', { name: /^Exclude /i });
    expect(excludeBtns.length).toBeGreaterThan(0);
    // All exclude controls live on cards inside the gallery (no footer chip row).
    expect(screen.getAllByRole('button', { name: /^Exclude /i })).toHaveLength(excludeBtns.length);

    fireEvent.click(excludeBtns[0]);
    expect(onToggleAssetExcluded).toHaveBeenCalled();
  });

  it('syncs gallery click to base image strip', () => {
    render(<AgencyImageStudioPanel {...baseProps} />);

    const gallery = screen.getByRole('grid', { name: /Asset gallery/i });
    const galleryCards = within(gallery).getAllByRole('button');
    expect(galleryCards.length).toBeGreaterThanOrEqual(2);
    fireEvent.click(galleryCards[1]);

    const pressedBase = screen
      .getAllByRole('button', { name: /Use .+ as base/i })
      .find((btn) => btn.getAttribute('aria-pressed') === 'true');
    expect(pressedBase).toBeTruthy();
  });

});
