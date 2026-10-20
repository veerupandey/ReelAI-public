import type { AspectRatio, StudioAsset } from './types';
import { getAspectNumericRatio } from './aspectRatioCatalog';

/**
 * Pure utility functions for the AI Image Studio.
 */

/**
 * Resolve a displayable `<img src>` for a studio asset.
 * Prefers base64 data URLs; falls back to remote previewUrl when downloads failed.
 */
export function resolveStudioAssetSrc(
  asset: Pick<StudioAsset, 'base64' | 'mimeType' | 'previewUrl'>,
): string | undefined {
  if (asset.base64) {
    if (
      asset.base64.startsWith('data:') ||
      asset.base64.startsWith('blob:') ||
      asset.base64.startsWith('http')
    ) {
      return asset.base64;
    }
    return `data:${asset.mimeType};base64,${asset.base64}`;
  }
  if (asset.previewUrl) return asset.previewUrl;
  return undefined;
}

/**
 * Truncates text to maxLength characters, appending "…" if truncated.
 * Returns the original string unchanged if its length ≤ maxLength.
 */
export function truncateText(text: string, maxLength: number): string {
  if (text.length <= maxLength) {
    return text;
  }
  return text.slice(0, maxLength) + '…';
}

/**
 * Validates a generation prompt.
 * Valid if it contains at least 1 non-whitespace character and total length ≤ 10000.
 */
export function validatePrompt(text: string): boolean {
  return text.length <= 10000 && /\S/.test(text);
}

/**
 * Validates a URL for image import.
 * Valid if it has an http or https scheme and its path ends with
 * a supported image extension (.png, .jpg, .jpeg, .webp).
 */
export function validateUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return false;
    }
    const path = parsed.pathname.toLowerCase();
    return /\.(png|jpg|jpeg|webp)$/.test(path);
  } catch {
    return false;
  }
}

/**
 * Validates a file's MIME type for import.
 * Accepts image/png, image/jpeg, and image/webp.
 */
export function validateFileType(mimeType: string): boolean {
  return mimeType === 'image/png' || mimeType === 'image/jpeg' || mimeType === 'image/webp';
}

/**
 * Validates a file's size for import.
 * Valid if ≤ 20 MB (20 * 1024 * 1024 bytes).
 */
export function validateFileSize(bytes: number): boolean {
  return bytes <= 20 * 1024 * 1024;
}

/**
 * Returns the number of grid columns for the asset gallery based on
 * viewport width and view mode.
 *
 * Default mode: 2 below 640, 3 for 640–1024, 4 for 1024–1440, 6 above 1440.
 * Compact mode: adds 2 to each default value.
 */
export function getColumnCount(viewportWidth: number, viewMode: 'default' | 'compact'): number {
  let columns: number;
  if (viewportWidth < 640) {
    columns = 2;
  } else if (viewportWidth < 1024) {
    columns = 3;
  } else if (viewportWidth < 1440) {
    columns = 4;
  } else {
    columns = 6;
  }
  return viewMode === 'compact' ? columns + 2 : columns;
}

/**
 * Validates that a field value does not exceed the given max length.
 */
export function validateFieldLength(value: string, maxLength: number): boolean {
  return value.length <= maxLength;
}

/**
 * Checks whether an image's dimensions conform to the selected aspect ratio
 * within a 1-pixel rounding tolerance.
 *
 * Passes if |width/height - expectedRatio| ≤ 1/min(width, height).
 */
export function checkAspectRatioConformance(
  width: number,
  height: number,
  ratio: AspectRatio,
): boolean {
  if (width <= 0 || height <= 0) {
    return false;
  }
  const expectedRatio = getAspectNumericRatio(ratio);
  const actualRatio = width / height;
  const tolerance = 1 / Math.min(width, height);
  return Math.abs(actualRatio - expectedRatio) <= tolerance;
}
