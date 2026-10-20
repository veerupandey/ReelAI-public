import React, { useState, useCallback, useRef } from 'react';
import type { StudioAsset } from './types';
import { importFiles, importFromUrl } from './assetIngestion';
import { truncateText } from './utils';

export interface AssetCollectionStepProps {
  assets: StudioAsset[];
  onAssetsAdded: (assets: StudioAsset[]) => void;
  onRemoveAsset: (id: string) => void;
  onBack: () => void;
  onNext: () => void;
  /** Shared session brand URL (editable across Import / Writer / Assistant) */
  brandUrlInput?: string;
  onBrandUrlChange?: (text: string) => void;
}

/**
 * AssetCollectionStep — A unified screen for importing assets from multiple sources:
 * - Multiple product/image URLs (one per line)
 * - File upload (multi-select)
 * - Drag and drop
 *
 * Shows accumulated assets as they arrive. User can remove individual assets.
 * Back goes to landing, Next proceeds to the AI Studio workspace.
 */
const AssetCollectionStep: React.FC<AssetCollectionStepProps> = ({
  assets,
  onAssetsAdded,
  onRemoveAsset,
  onBack,
  onNext,
  brandUrlInput = '',
  onBrandUrlChange,
}) => {
  const [urls, setUrls] = useState('');
  const [isImporting, setIsImporting] = useState(false);
  const [importProgress, setImportProgress] = useState('');
  const [errors, setErrors] = useState<string[]>([]);
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // --- URL Import (multiple) ---
  const handleImportUrls = useCallback(async () => {
    const urlList = urls
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0);

    if (urlList.length === 0) return;

    setIsImporting(true);
    setErrors([]);
    const newErrors: string[] = [];

    for (let i = 0; i < urlList.length; i++) {
      const url = urlList[i];
      setImportProgress(`Importing ${i + 1} of ${urlList.length}...`);

      const result = await importFromUrl(url);
      if ('asset' in result) {
        onAssetsAdded([result.asset]);
      } else if ('assets' in result) {
        onAssetsAdded(result.assets);
      } else {
        newErrors.push(`${truncateText(url, 40)}: ${result.error.message}`);
      }
    }

    setIsImporting(false);
    setImportProgress('');
    setErrors(newErrors);
    if (newErrors.length === 0) {
      setUrls('');
    }
  }, [urls, onAssetsAdded]);

  // --- File Upload ---
  const handleFileChange = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const files = e.target.files;
      if (!files || files.length === 0) return;

      setIsImporting(true);
      setImportProgress(`Processing ${files.length} file${files.length > 1 ? 's' : ''}...`);

      const result = await importFiles(Array.from(files));
      if (result.assets.length > 0) {
        onAssetsAdded(result.assets);
      }
      if (result.errors.length > 0) {
        setErrors((prev) => [...prev, ...result.errors.map((e) => e.message)]);
      }

      setIsImporting(false);
      setImportProgress('');
      if (fileInputRef.current) fileInputRef.current.value = '';
    },
    [onAssetsAdded],
  );

  // --- Drag and Drop ---
  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);

      const files = Array.from<File>(e.dataTransfer.files);
      if (files.length === 0) return;

      setIsImporting(true);
      setImportProgress(`Processing ${files.length} dropped file${files.length > 1 ? 's' : ''}...`);

      const result = await importFiles(files);
      if (result.assets.length > 0) {
        onAssetsAdded(result.assets);
      }
      if (result.errors.length > 0) {
        setErrors((prev) => [...prev, ...result.errors.map((e) => e.message)]);
      }

      setIsImporting(false);
      setImportProgress('');
    },
    [onAssetsAdded],
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  return (
    <div
      className="image-studio-root flex flex-col h-full bg-studio-canvas"
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
    >
      {/* Header */}
      <div className="px-6 py-4 border-b border-studio-border flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold text-white">Import Assets</h2>
          <p className="text-sm text-gray-400 mt-0.5">
            Add product URLs, upload images, or drag & drop — all at once
          </p>
        </div>
        <div className="flex items-center gap-2">
          {assets.length > 0 && (
            <span className="text-sm text-emerald-400 font-medium">
              {assets.length} image{assets.length !== 1 ? 's' : ''} ready
            </span>
          )}
        </div>
      </div>

      {/* Main content */}
      <div className="flex-1 overflow-y-auto p-6">
        <div className="max-w-4xl mx-auto space-y-6">

          {/* Brand URL — shared with Assistant & Prompt Writer */}
          {onBrandUrlChange && (
            <div className="mb-5">
              <div className="flex items-center gap-2 mb-2">
                <svg className="w-4 h-4 text-studio-accent" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m13.35-.622l1.757-1.757a4.5 4.5 0 00-6.364-6.364l-4.5 4.5a4.5 4.5 0 001.242 7.244" />
                </svg>
                <h3 className="text-white font-semibold text-sm">Brand website</h3>
              </div>
              <p className="text-gray-500 text-xs mb-2">
                Optional. Saved for Creative Assistant and Prompt Writer — edit anytime.
              </p>
              <input
                type="url"
                value={brandUrlInput}
                onChange={(e) => onBrandUrlChange(e.target.value)}
                placeholder="https://yourbrand.com"
                className="w-full px-4 py-2.5 bg-studio-canvas/40 border border-studio-border rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-studio-accent/50"
                aria-label="Brand website URL"
              />
            </div>
          )}

          {/* URL Input Section */}
          <div className="bg-studio-surface rounded-2xl border border-studio-border p-5">
            <div className="flex items-center gap-2 mb-3">
              <svg className="w-5 h-5 text-cyan-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                <path strokeLinecap="round" strokeLinejoin="round" d="M13.19 8.688a4.5 4.5 0 011.242 7.244l-4.5 4.5a4.5 4.5 0 01-6.364-6.364l1.757-1.757m9.07-9.07l4.5-4.5a4.5 4.5 0 016.364 6.364l-1.757 1.757" />
              </svg>
              <h3 className="text-white font-semibold text-sm">Product & Image URLs</h3>
            </div>
            <p className="text-xs text-gray-500 mb-3">
              Paste one URL per line. Supports Shopify product pages, direct image URLs, or any product page.
            </p>
            <textarea
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder={"https://store.com/products/my-product\nhttps://example.com/image.png\nhttps://another-store.com/products/item"}
              className="w-full min-h-[100px] px-4 py-3 bg-studio-canvas/40 border border-studio-border rounded-xl text-white text-sm placeholder-gray-600 focus:outline-none focus:ring-2 focus:ring-cyan-500/50 focus:border-transparent resize-y"
              disabled={isImporting}
            />
            <button
              type="button"
              onClick={handleImportUrls}
              disabled={isImporting || !urls.trim()}
              className="mt-3 px-5 py-2.5 rounded-xl bg-cyan-600 hover:bg-cyan-700 text-white font-medium text-sm disabled:opacity-40 disabled:cursor-not-allowed transition-colors focus:outline-none focus:ring-2 focus:ring-cyan-400 focus:ring-offset-2 focus:ring-offset-studio-canvas"
            >
              {isImporting ? importProgress : 'Import All URLs'}
            </button>
          </div>

          {/* File Upload Section */}
          <div
            className={`bg-studio-surface rounded-2xl border-2 border-dashed p-8 text-center transition-all cursor-pointer ${
              isDragOver
                ? 'border-studio-accent bg-studio-accent/10'
                : 'border-studio-border hover:border-gray-500'
            }`}
            onClick={() => fileInputRef.current?.click()}
          >
            <svg className="w-10 h-10 mx-auto text-gray-500 mb-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 16.5v2.25A2.25 2.25 0 005.25 21h13.5A2.25 2.25 0 0021 18.75V16.5m-13.5-9L12 3m0 0l4.5 4.5M12 3v13.5" />
            </svg>
            <p className="text-white font-medium text-sm mb-1">
              {isDragOver ? 'Drop files here' : 'Click to upload or drag & drop'}
            </p>
            <p className="text-gray-500 text-xs">PNG, JPEG, WebP • Up to 20MB each • Max 100 files</p>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/png,image/jpeg,image/webp"
              multiple
              onChange={handleFileChange}
              className="hidden"
            />
          </div>

          {/* Errors */}
          {errors.length > 0 && (
            <div className="bg-red-900/20 border border-red-500/30 rounded-xl p-4">
              <div className="flex items-center justify-between mb-2">
                <span className="text-red-300 text-xs font-semibold uppercase tracking-wider">Import Errors</span>
                <button
                  type="button"
                  onClick={() => setErrors([])}
                  className="text-red-400 text-xs hover:text-red-300"
                >
                  Dismiss
                </button>
              </div>
              <ul className="space-y-1">
                {errors.map((err, i) => (
                  <li key={i} className="text-red-200 text-xs">{err}</li>
                ))}
              </ul>
            </div>
          )}

          {/* Imported Assets Preview */}
          {assets.length > 0 && (
            <div>
              <div className="flex items-center justify-between mb-3">
                <h3 className="text-white font-semibold text-sm">
                  Imported Assets ({assets.length})
                </h3>
              </div>
              <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 lg:grid-cols-8 gap-2">
                {assets.map((asset) => (
                  <div
                    key={asset.id}
                    className="relative group rounded-lg overflow-hidden border border-studio-border bg-studio-surface"
                  >
                    <div className="aspect-square">
                      {asset.base64 ? (
                        <img
                          src={`data:${asset.mimeType};base64,${asset.base64}`}
                          alt={asset.name}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center bg-studio-canvas/40 text-gray-600 text-lg">
                          🖼
                        </div>
                      )}
                    </div>
                    {/* Remove button on hover */}
                    <button
                      type="button"
                      onClick={() => onRemoveAsset(asset.id)}
                      className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-600/80 text-white text-xs flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity focus:opacity-100 focus:outline-none"
                      aria-label={`Remove ${asset.name}`}
                    >
                      ✕
                    </button>
                    {/* Name */}
                    <p className="px-1.5 py-1 text-[10px] text-gray-400 truncate">
                      {truncateText(asset.name, 20)}
                    </p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer with Back/Next */}
      <div className="px-6 py-4 border-t border-studio-border flex items-center justify-between">
        <button
          type="button"
          onClick={onBack}
          className="px-5 py-2.5 rounded-xl bg-white/5 border border-white/10 text-gray-300 font-medium text-sm hover:bg-white/10 hover:text-white transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2 focus:ring-offset-studio-canvas"
        >
          ← Back
        </button>
        <button
          type="button"
          onClick={onNext}
          disabled={assets.length === 0}
          className="px-6 py-2.5 rounded-xl bg-gradient-to-r from-studio-accent to-cyan-500 text-white font-bold text-sm disabled:opacity-40 disabled:cursor-not-allowed hover:shadow-lg hover:shadow-studio-accent/25 transition-all focus:outline-none focus:ring-2 focus:ring-studio-accent focus:ring-offset-2 focus:ring-offset-studio-canvas"
        >
          Open Studio →
        </button>
      </div>
    </div>
  );
};

export default AssetCollectionStep;
