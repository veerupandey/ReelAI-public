/**
 * Auto-saves generated images to disk via the dev-server /api/save-image endpoint.
 * Images are grouped into a session folder named after the app start time,
 * e.g. generated-images/2026-06-09_17-02-31/.
 */

import type { StudioAsset } from './types';

/** Session folder name, fixed when the app (module) first loads. */
const SESSION_FOLDER = (() => {
  const now = new Date();
  const pad = (n: number) => String(n).padStart(2, '0');
  return [
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`,
    `${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}`,
  ].join('_');
})();

export function getSessionFolder(): string {
  return SESSION_FOLDER;
}

/**
 * Fire-and-forget save of a generated asset to disk.
 * Fails silently (with a console warning) so generation UX is never blocked,
 * e.g. in production builds where the dev endpoint does not exist.
 */
export async function saveAssetToDisk(asset: Pick<StudioAsset, 'id' | 'name' | 'base64' | 'mimeType'>): Promise<boolean> {
  try {
    const response = await fetch('/api/save-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        session: SESSION_FOLDER,
        name: `${asset.name || 'generated'}_${asset.id.slice(0, 8)}`,
        base64: asset.base64,
        mimeType: asset.mimeType,
      }),
    });
    if (!response.ok) {
      console.warn('[diskSaveService] Save failed:', response.status, await response.text());
      return false;
    }
    return true;
  } catch (error) {
    console.warn('[diskSaveService] Save unavailable (dev server only):', error);
    return false;
  }
}
