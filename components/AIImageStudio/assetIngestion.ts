import type { StudioAsset } from './types';
import { validateFileType, validateFileSize, validateUrl } from './utils';
import { importProductPageAssetsRich } from '../../services/productPageImportService';
import type { BrandAsset } from '../../types/brand';

const MAX_BATCH_SIZE = 100;
const URL_TIMEOUT_MS = 10_000;

export interface ImportError {
  fileName: string;
  reason: 'unsupported_format' | 'size_exceeded' | 'batch_limit';
  message: string;
}

export interface ImportResult {
  assets: StudioAsset[];
  errors: ImportError[];
}

export interface UrlImportError {
  url: string;
  reason: 'invalid_url' | 'network_error' | 'timeout' | 'invalid_response';
  message: string;
}

/**
 * Reads a File as a base64 data URL string.
 */
function readFileAsBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      // Strip the data URL prefix (e.g. "data:image/png;base64,")
      const base64 = result.split(',')[1];
      resolve(base64);
    };
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

/**
 * Gets image dimensions by loading base64 data into an Image element.
 */
function getImageDimensions(base64: string, mimeType: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    };
    img.onerror = () => reject(new Error('Failed to load image for dimension reading'));
    img.src = `data:${mimeType};base64,${base64}`;
  });
}

/**
 * Imports a batch of files, validating each for type, size, and batch limit.
 * Returns successfully imported assets and error entries for rejected files.
 *
 * - Accepts PNG, JPEG, WebP up to 20MB each
 * - Max 20 files per batch; files beyond 20 get a batch_limit error
 * - Valid files are converted to base64 StudioAsset objects
 */
export async function importFiles(files: File[]): Promise<ImportResult> {
  const assets: StudioAsset[] = [];
  const errors: ImportError[] = [];

  // Files beyond the batch limit get an error
  if (files.length > MAX_BATCH_SIZE) {
    for (let i = MAX_BATCH_SIZE; i < files.length; i++) {
      errors.push({
        fileName: files[i].name,
        reason: 'batch_limit',
        message: `Maximum ${MAX_BATCH_SIZE} files per batch. Only the first ${MAX_BATCH_SIZE} were imported.`,
      });
    }
  }

  // Process up to MAX_BATCH_SIZE files
  const filesToProcess = files.slice(0, MAX_BATCH_SIZE);

  for (const file of filesToProcess) {
    // Validate file type
    if (!validateFileType(file.type)) {
      errors.push({
        fileName: file.name,
        reason: 'unsupported_format',
        message: `'${file.name}' rejected: unsupported format. Use PNG, JPEG, or WebP.`,
      });
      continue;
    }

    // Validate file size
    if (!validateFileSize(file.size)) {
      errors.push({
        fileName: file.name,
        reason: 'size_exceeded',
        message: `'${file.name}' rejected: exceeds 20 MB limit.`,
      });
      continue;
    }

    // Convert to base64 and get dimensions
    try {
      const base64 = await readFileAsBase64(file);
      const { width, height } = await getImageDimensions(base64, file.type);

      const asset: StudioAsset = {
        id: crypto.randomUUID(),
        name: file.name,
        description: '',
        base64,
        mimeType: file.type as StudioAsset['mimeType'],
        width,
        height,
        source: 'upload',
        createdAt: new Date().toISOString(),
      };

      assets.push(asset);
    } catch {
      errors.push({
        fileName: file.name,
        reason: 'unsupported_format',
        message: `'${file.name}' rejected: failed to process file.`,
      });
    }
  }

  return { assets, errors };
}

/**
 * Extracts a filename from a URL path.
 * Falls back to 'imported-image' if no filename can be determined.
 */
function getFilenameFromUrl(url: string): string {
  try {
    const parsed = new URL(url);
    const pathSegments = parsed.pathname.split('/');
    const lastSegment = pathSegments[pathSegments.length - 1];
    return lastSegment || 'imported-image';
  } catch {
    return 'imported-image';
  }
}

/**
 * Determines MIME type from a URL's file extension.
 */
function getMimeTypeFromUrl(url: string): StudioAsset['mimeType'] | null {
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.toLowerCase();
    if (path.endsWith('.png')) return 'image/png';
    if (path.endsWith('.jpg') || path.endsWith('.jpeg')) return 'image/jpeg';
    if (path.endsWith('.webp')) return 'image/webp';
    return null;
  } catch {
    return null;
  }
}

/**
 * Imports an image from a URL with a 10-second timeout.
 * Validates the URL scheme (http/https) and extension before fetching.
 * Returns either a StudioAsset or an error describing the failure.
 *
 * If the URL doesn't end with a supported image extension but looks like
 * a product page (e.g. Shopify /products/ URL), it will automatically
 * attempt a product page import instead.
 */
export async function importFromUrl(
  url: string,
): Promise<{ asset: StudioAsset } | { assets: StudioAsset[] } | { error: UrlImportError }> {
  const trimmedUrl = url.trim();

  // Check if it's a direct image URL
  if (validateUrl(trimmedUrl)) {
    return importDirectImageUrl(trimmedUrl);
  }

  // Check if it looks like a valid http/https URL (but not a direct image)
  // If so, try product page import
  try {
    const parsed = new URL(trimmedUrl.startsWith('http') ? trimmedUrl : `https://${trimmedUrl}`);
    if (parsed.protocol === 'http:' || parsed.protocol === 'https:') {
      // Attempt product page import (Shopify, etc.)
      return importFromProductPage(parsed.toString());
    }
  } catch {
    // Not a valid URL at all
  }

  return {
    error: {
      url: trimmedUrl,
      reason: 'invalid_url',
      message: 'Invalid URL: must use http/https. Provide a direct image URL or a product page URL.',
    },
  };
}

/**
 * Imports a direct image URL (must end with .png, .jpg, .jpeg, or .webp).
 */
async function importDirectImageUrl(
  url: string,
): Promise<{ asset: StudioAsset } | { error: UrlImportError }> {
  const mimeType = getMimeTypeFromUrl(url);
  if (!mimeType) {
    return {
      error: {
        url,
        reason: 'invalid_url',
        message: 'Invalid URL: unsupported image format.',
      },
    };
  }

  // Fetch with 10s timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      return {
        error: {
          url,
          reason: 'invalid_response',
          message: `Failed to import from URL: server returned ${response.status}.`,
        },
      };
    }

    const blob = await response.blob();
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        resolve(result.split(',')[1]);
      };
      reader.onerror = () => reject(new Error('Failed to read response'));
      reader.readAsDataURL(blob);
    });

    const { width, height } = await getImageDimensions(base64, mimeType);
    const fileName = getFilenameFromUrl(url);

    const asset: StudioAsset = {
      id: crypto.randomUUID(),
      name: fileName,
      description: '',
      base64,
      mimeType,
      width,
      height,
      source: 'url_import',
      createdAt: new Date().toISOString(),
    };

    return { asset };
  } catch (err: unknown) {
    clearTimeout(timeoutId);

    if (err instanceof Error && err.name === 'AbortError') {
      return {
        error: {
          url,
          reason: 'timeout',
          message: 'URL import timed out after 10 seconds.',
        },
      };
    }

    return {
      error: {
        url,
        reason: 'network_error',
        message: `Failed to import from URL: ${err instanceof Error ? err.message : 'network error'}.`,
      },
    };
  }
}

/**
 * Converts a BrandAsset (from productPageImportService) to a StudioAsset.
 */
function brandAssetToStudioAsset(asset: BrandAsset, productTitle: string): StudioAsset {
  const mimeType = (['image/png', 'image/jpeg', 'image/webp'].includes(asset.mimeType)
    ? asset.mimeType
    : 'image/jpeg') as StudioAsset['mimeType'];

  return {
    id: crypto.randomUUID(),
    name: asset.description || asset.sourceProductTitle || productTitle || 'Product image',
    description: asset.semanticDescription || asset.description || '',
    base64: asset.base64 || '',
    mimeType,
    width: 0, // Dimensions not available from BrandAsset
    height: 0,
    source: 'url_import',
    createdAt: new Date().toISOString(),
  };
}

/**
 * Imports all product images from a product page URL.
 * Works with Shopify, and any page with product images.
 * Uses the existing productPageImportService which handles:
 * - Shopify CDN image extraction
 * - Jina proxy for page scraping
 * - Image scoring and ranking
 * - Direct and proxy-based image fetching
 */
export async function importFromProductPage(
  url: string,
): Promise<{ assets: StudioAsset[] } | { error: UrlImportError }> {
  try {
    const result = await importProductPageAssetsRich(url, undefined, {
      executionMode: 'fast',
      analyzeAssets: false, // Skip AI analysis for speed in the studio
    });

    if (!result.pageReachable) {
      return {
        error: {
          url,
          reason: 'network_error',
          message: result.warnings[0] || 'Could not reach the product page.',
        },
      };
    }

    if (result.assets.length === 0) {
      return {
        error: {
          url,
          reason: 'invalid_response',
          message: result.warnings[0] || 'No product images found on this page. Try a direct image URL instead.',
        },
      };
    }

    // For assets that have previewUrl but no base64, fetch and convert them
    const assetsWithData = await Promise.all(
      result.assets
        .filter((asset) => asset.base64 || asset.previewUrl)
        .map(async (asset) => {
          if (asset.base64) return asset;
          // Attempt to fetch the previewUrl and convert to base64
          try {
            const controller = new AbortController();
            const timeoutId = setTimeout(() => controller.abort(), URL_TIMEOUT_MS);
            const resp = await fetch(asset.previewUrl!, { signal: controller.signal });
            clearTimeout(timeoutId);
            if (!resp.ok) return null;
            const blob = await resp.blob();
            const base64 = await new Promise<string>((resolve, reject) => {
              const reader = new FileReader();
              reader.onload = () => resolve((reader.result as string).split(',')[1]);
              reader.onerror = () => reject();
              reader.readAsDataURL(blob);
            });
            const mimeType = (blob.type || 'image/jpeg') as BrandAsset['mimeType'];
            return { ...asset, base64, mimeType };
          } catch {
            return null;
          }
        })
    );

    // Convert BrandAssets to StudioAssets, dropping any that still have no data
    const studioAssets = assetsWithData
      .filter((asset): asset is NonNullable<typeof asset> => asset !== null && !!asset.base64)
      .map((asset) => brandAssetToStudioAsset(asset, result.productTitle));

    if (studioAssets.length === 0) {
      return {
        error: {
          url,
          reason: 'invalid_response',
          message: 'Found product images but could not download them (CORS restrictions). Try downloading manually and uploading.',
        },
      };
    }

    return { assets: studioAssets };
  } catch (err: unknown) {
    return {
      error: {
        url,
        reason: 'network_error',
        message: `Product page import failed: ${err instanceof Error ? err.message : 'unknown error'}.`,
      },
    };
  }
}
