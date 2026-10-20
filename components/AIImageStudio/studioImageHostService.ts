/**
 * Host studio images at public URLs for Instagram Graph API publishing.
 * Cloud hosting (formerly Supabase Storage) is not configured in this build.
 */
import type { StudioAsset } from './types';

export const STUDIO_PUBLISH_BUCKET =
  (typeof import.meta !== 'undefined' && import.meta.env?.VITE_STUDIO_PUBLISH_BUCKET) ||
  'studio-publish';

export function isStudioImageHostingConfigured(): boolean {
  return false;
}

/**
 * Upload assets in order and return public HTTPS URLs (same order).
 */
export async function hostStudioImagesForPublish(
  _assets: StudioAsset[],
): Promise<string[]> {
  throw new Error(
    'Image hosting not configured. Live Instagram publish needs a public image host; captions and local export still work.',
  );
}
