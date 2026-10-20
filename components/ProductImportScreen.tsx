import React, { useState, useEffect } from 'react';
import type { ProductContext, Brand } from '../types/brand';
import { parseProductImportUrls } from '../services/productPageImportService';

interface Props {
  brand: Brand | null;
  productUrl: string;
  setProductUrl: (url: string) => void;
  lockedProduct: ProductContext | null;
  isImporting: boolean;
  onImport: (url: string) => void;
  onBack: () => void;
  onNext: () => void;
  importWarnings?: string[];
  importError?: string | null;
}

const ProductImportScreen: React.FC<Props> = ({
  brand,
  productUrl,
  setProductUrl,
  lockedProduct,
  isImporting,
  onImport,
  onBack,
  onNext,
  importWarnings = [],
  importError = null,
}) => {
  const [localUrl, setLocalUrl] = useState(productUrl);

  useEffect(() => {
    if (brand?.websiteUrl && !localUrl) {
      setLocalUrl(brand.websiteUrl);
    }
  }, [brand?.websiteUrl, localUrl]);

  const detectedUrls = parseProductImportUrls(localUrl);
  const hasValidUrl = detectedUrls.length > 0;
  const assetCount = lockedProduct?.productAssets?.length ?? 0;
  const canContinue = Boolean(lockedProduct) && assetCount > 0 && !isImporting;

  const handleImport = () => {
    if (!hasValidUrl || isImporting) return;
    const normalizedInput = detectedUrls.join(', ');
    setProductUrl(normalizedInput);
    onImport(normalizedInput);
  };

  return (
    <div className="space-y-8">
      <div className="text-center mb-8">
        <h2 className="text-3xl font-bold text-white mb-2">Import Product</h2>
        <p className="text-gray-400">
          Enter one or more product or store URLs (comma or space separated) to import product details and images
        </p>
      </div>

      <div className="max-w-3xl mx-auto space-y-6">
        <div className="bg-dark-card rounded-2xl border border-dark-border p-6 space-y-4">
          <label className="block text-sm font-medium text-gray-300">
            Product URL{detectedUrls.length > 1 ? 's' : ''}
          </label>
          <div className="flex gap-3">
            <input
              type="text"
              value={localUrl}
              onChange={(e) => setLocalUrl(e.target.value)}
              placeholder="kageha.ca or https://example.com/products/your-product"
              className="flex-1 px-4 py-3 rounded-xl bg-dark-bg border border-dark-border text-white placeholder-gray-500 focus:border-purple-500 focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && hasValidUrl && !isImporting) {
                  handleImport();
                }
              }}
            />
            <button
              onClick={handleImport}
              disabled={!hasValidUrl || isImporting}
              className="px-6 py-3 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold disabled:opacity-50 hover:shadow-lg hover:shadow-purple-500/25 transition-all flex items-center gap-2"
            >
              {isImporting && (
                <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/35 border-t-white" />
              )}
              {isImporting ? 'Importing...' : 'Import'}
            </button>
          </div>
          {detectedUrls.length > 0 && (
            <div className="flex flex-col gap-1">
              {detectedUrls.map((url) => (
                <div key={url} className="flex items-center gap-2 text-xs text-emerald-400">
                  <span>✓</span>
                  <span className="truncate">{url}</span>
                </div>
              ))}
              {detectedUrls.length > 1 && (
                <p className="text-[11px] text-gray-500 pt-1">
                  {detectedUrls.length} URLs detected — assets will be merged from all pages
                </p>
              )}
            </div>
          )}
        </div>

        {isImporting && (
          <div className="bg-dark-card rounded-2xl border border-purple-500/30 p-5 flex items-start gap-3">
            <span className="mt-0.5 h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-purple-400/35 border-t-purple-300" />
            <div>
              <p className="text-sm font-medium text-white">Importing product images…</p>
              <p className="text-xs text-gray-400 mt-1">
                {detectedUrls.length > 1
                  ? `Fetching ${detectedUrls.length} pages and downloading product shots.`
                  : 'Fetching the page, following product links when needed, and downloading shots.'}
              </p>
            </div>
          </div>
        )}

        {importError && !isImporting && (
          <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-4 py-3 text-sm text-red-200">
            {importError}
          </div>
        )}

        {importWarnings.length > 0 && !isImporting && (
          <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-4 py-3 space-y-1.5">
            <p className="text-xs font-semibold uppercase tracking-wide text-amber-300">Import notes</p>
            {importWarnings.map((warning, index) => (
              <p key={`${index}-${warning.slice(0, 24)}`} className="text-sm text-amber-100/90">
                {warning}
              </p>
            ))}
          </div>
        )}

        {lockedProduct && (
          <div className="bg-dark-card rounded-2xl border border-dark-border overflow-hidden">
            <div className="px-6 py-4 bg-gradient-to-r from-purple-600/10 to-pink-500/10 border-b border-dark-border">
              <h3 className="text-lg font-bold text-white">Product Knowledge</h3>
              <p className="text-xs text-gray-400">What the system knows about this product</p>
            </div>

            <div className="p-6 space-y-6">
              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Product Name</h4>
                <p className="text-white text-lg font-semibold">{lockedProduct.productTitle}</p>
              </div>

              {lockedProduct.brandName && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Brand</h4>
                  <p className="text-white">{lockedProduct.brandName}</p>
                </div>
              )}

              {lockedProduct.productFacts.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Key Facts & Ingredients</h4>
                  <div className="flex flex-wrap gap-2">
                    {lockedProduct.productFacts.map((fact, index) => (
                      <span
                        key={index}
                        className="px-3 py-1.5 rounded-lg bg-purple-500/10 border border-purple-500/20 text-xs text-purple-200"
                      >
                        {fact}
                      </span>
                    ))}
                  </div>
                </div>
              )}

              {lockedProduct.allowedClaims.length > 0 && (
                <div>
                  <h4 className="text-sm font-medium text-gray-400 mb-2">Verified Claims</h4>
                  <ul className="space-y-2">
                    {lockedProduct.allowedClaims.map((claim, index) => (
                      <li key={index} className="flex items-start gap-2 text-sm text-gray-300">
                        <span className="text-emerald-400 mt-0.5">✓</span>
                        <span>{claim}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              <div>
                <h4 className="text-sm font-medium text-gray-400 mb-2">Available Assets</h4>
                <p className="text-white">
                  {assetCount} asset{assetCount === 1 ? '' : 's'} imported
                </p>
                {assetCount === 0 && (
                  <p className="text-xs text-amber-300 mt-2">
                    No images were imported. Re-import a product page URL before continuing.
                  </p>
                )}
              </div>
            </div>

            <div className="px-6 py-4 bg-dark-bg/50 border-t border-dark-border flex items-center justify-between gap-4">
              <p className="text-xs text-gray-500">
                Review this information before proceeding to image curation
              </p>
              <button
                onClick={onNext}
                disabled={!canContinue}
                title={canContinue ? undefined : 'Import at least one product image to continue'}
                className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-purple-600 to-pink-500 text-white font-bold hover:shadow-lg hover:shadow-purple-500/25 transition-all disabled:opacity-40 disabled:cursor-not-allowed disabled:hover:shadow-none"
              >
                Continue to Images →
              </button>
            </div>
          </div>
        )}

        {!lockedProduct && !isImporting && (
          <div className="bg-dark-card/50 rounded-2xl border border-dark-border border-dashed p-8 text-center">
            <div className="w-16 h-16 mx-auto rounded-2xl bg-purple-500/10 flex items-center justify-center text-3xl mb-4">
              📦
            </div>
            <p className="text-gray-400">
              Enter one or more product or store URLs above (bare domains like kageha.ca work) to import
              product details, ingredients, claims, and assets
            </p>
          </div>
        )}

        <div className="flex justify-start">
          <button
            type="button"
            onClick={onBack}
            className="text-sm text-gray-400 hover:text-white transition-colors"
          >
            ← Back to brands
          </button>
        </div>
      </div>
    </div>
  );
};

export default ProductImportScreen;
