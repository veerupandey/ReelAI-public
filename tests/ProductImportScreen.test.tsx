import React from 'react';
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import ProductImportScreen from '../components/ProductImportScreen';
import type { ProductContext } from '../types/brand';

const lockedProduct: ProductContext = {
  productId: 'https://kageha.ca',
  productTitle: 'Kageha Matcha',
  productUrl: 'https://kageha.ca',
  brandName: 'Kageha',
  productAssets: [
    {
      id: 'a1',
      type: 'product',
      base64: 'abc',
      mimeType: 'image/jpeg',
      description: 'Tin',
      previewUrl: 'https://cdn.example.com/tin.jpg',
    },
  ],
  productFacts: ['Ceremonial grade'],
  allowedClaims: [],
  platform: 'tiktok',
  durationSec: 30,
};

describe('ProductImportScreen', () => {
  it('accepts bare domains and enables Import', () => {
    const onImport = vi.fn();
    render(
      <ProductImportScreen
        brand={null}
        productUrl=""
        setProductUrl={vi.fn()}
        lockedProduct={null}
        isImporting={false}
        onImport={onImport}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    const input = screen.getByPlaceholderText(/kageha\.ca/i);
    fireEvent.change(input, { target: { value: 'kageha.ca' } });
    expect(screen.getByText('https://kageha.ca')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(onImport).toHaveBeenCalledWith('https://kageha.ca');
  });

  it('surfaces warnings and blocks Continue when there are no assets', () => {
    const onNext = vi.fn();
    const emptyProduct: ProductContext = {
      ...lockedProduct,
      productAssets: [],
    };

    render(
      <ProductImportScreen
        brand={null}
        productUrl="https://kageha.ca"
        setProductUrl={vi.fn()}
        lockedProduct={emptyProduct}
        isImporting={false}
        importWarnings={['Enriched import with product-page galleries.']}
        importError={null}
        onImport={vi.fn()}
        onBack={vi.fn()}
        onNext={onNext}
      />,
    );

    expect(screen.getByText(/Import notes/i)).toBeTruthy();
    expect(screen.getByText(/product-page galleries/i)).toBeTruthy();

    const continueButton = screen.getByRole('button', { name: /Continue to Images/i });
    expect((continueButton as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(continueButton);
    expect(onNext).not.toHaveBeenCalled();
  });

  it('allows Continue when imported assets exist', () => {
    const onNext = vi.fn();
    render(
      <ProductImportScreen
        brand={null}
        productUrl="https://kageha.ca"
        setProductUrl={vi.fn()}
        lockedProduct={lockedProduct}
        isImporting={false}
        onImport={vi.fn()}
        onBack={vi.fn()}
        onNext={onNext}
      />,
    );

    const continueButton = screen.getByRole('button', { name: /Continue to Images/i });
    expect((continueButton as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(continueButton);
    expect(onNext).toHaveBeenCalled();
  });

  it('shows import progress while importing', () => {
    render(
      <ProductImportScreen
        brand={null}
        productUrl="https://kageha.ca"
        setProductUrl={vi.fn()}
        lockedProduct={null}
        isImporting
        onImport={vi.fn()}
        onBack={vi.fn()}
        onNext={vi.fn()}
      />,
    );

    expect(screen.getByText(/Importing product images/i)).toBeTruthy();
  });
});
