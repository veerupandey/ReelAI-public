/**
 * In-memory stash for Agency → Agent Console launch binaries.
 * sessionStorage cannot hold multi-image base64 payloads (~5MB quota).
 *
 * Hub/Agency launch envelopes also live in memory so Console hydration survives
 * React remounts (Strict Mode / Vite HMR) that would otherwise re-read an empty
 * sessionStorage after the first effect consumed it.
 */

export type AgentLaunchHeavyPayload = {
  sceneAssetBank: Record<string, { base64: string; mimeType: string; name?: string }>;
  referenceUploads: Array<{
    id: string;
    name: string;
    base64: string;
    mimeType: string;
    previewUrl?: string;
    note?: string;
  }>;
  productBase64?: string;
  productMimeType?: string;
};

export type HubLaunchEnvelope = {
  agentId: string;
  params: Record<string, any>;
  launchId: string;
};

const heavyByLaunchId = new Map<string, AgentLaunchHeavyPayload>();
/** Module-local mirror; window bridge survives Vite HMR module replacement. */
let pendingHubLaunch: HubLaunchEnvelope | null = null;

const WINDOW_LAUNCH_KEY = '__reelaiPendingHubLaunch';

function readWindowLaunch(): HubLaunchEnvelope | null {
  if (typeof window === 'undefined') return null;
  const value = (window as unknown as Record<string, unknown>)[WINDOW_LAUNCH_KEY];
  if (!value || typeof value !== 'object') return null;
  const envelope = value as HubLaunchEnvelope;
  return envelope.params ? envelope : null;
}

function writeWindowLaunch(envelope: HubLaunchEnvelope | null): void {
  if (typeof window === 'undefined') return;
  (window as unknown as Record<string, unknown>)[WINDOW_LAUNCH_KEY] = envelope;
}

export function stashPendingHubLaunch(envelope: HubLaunchEnvelope): void {
  pendingHubLaunch = envelope;
  writeWindowLaunch(envelope);
  try {
    sessionStorage.setItem('agentHub_launch', JSON.stringify(envelope));
  } catch {
    // Memory/window stash is authoritative; sessionStorage is a cross-reload fallback.
  }
}

/**
 * Peek the pending Hub/Agency launch without clearing.
 * Order: module → window (HMR-safe) → sessionStorage.
 */
export function peekPendingHubLaunch(): HubLaunchEnvelope | null {
  if (pendingHubLaunch) return pendingHubLaunch;
  const fromWindow = readWindowLaunch();
  if (fromWindow) {
    pendingHubLaunch = fromWindow;
    return pendingHubLaunch;
  }
  try {
    const raw = sessionStorage.getItem('agentHub_launch');
    if (!raw) return null;
    const parsed = JSON.parse(raw) as HubLaunchEnvelope;
    if (!parsed || typeof parsed !== 'object' || !parsed.params) return null;
    pendingHubLaunch = parsed;
    writeWindowLaunch(parsed);
    return pendingHubLaunch;
  } catch {
    try { sessionStorage.removeItem('agentHub_launch'); } catch { /* ignore */ }
    return null;
  }
}

export function clearPendingHubLaunch(): void {
  const launchId = pendingHubLaunch?.launchId || readWindowLaunch()?.launchId;
  if (launchId) {
    takeAgentLaunchHeavy(launchId);
  }
  pendingHubLaunch = null;
  writeWindowLaunch(null);
  try { sessionStorage.removeItem('agentHub_launch'); } catch { /* ignore */ }
}

export function stashAgentLaunchHeavy(
  launchId: string,
  heavy: AgentLaunchHeavyPayload,
): void {
  heavyByLaunchId.set(launchId, heavy);
}

export function takeAgentLaunchHeavy(
  launchId: string,
): AgentLaunchHeavyPayload | undefined {
  const value = heavyByLaunchId.get(launchId);
  if (value) heavyByLaunchId.delete(launchId);
  return value;
}

export function peekAgentLaunchHeavy(
  launchId: string,
): AgentLaunchHeavyPayload | undefined {
  return heavyByLaunchId.get(launchId);
}

/**
 * Split heavy base64 fields from an Ad Agent Hub launch so sessionStorage
 * stays under quota. AgentConsole rehydrates via takeAgentLaunchHeavy(launchId).
 */
export function prepareHubAgentLaunchForSessionStorage(
  params: Record<string, unknown>,
  agentId: string = 'ad-agent',
): { agentId: string; params: Record<string, unknown>; launchId: string } {
  const launchId = `hub-launch-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
  const referenceUploads = Array.isArray(params.referenceUploads)
    ? (params.referenceUploads as AgentLaunchHeavyPayload['referenceUploads'])
    : [];
  const productBase64 = typeof params.productBase64 === 'string' ? params.productBase64 : undefined;
  const productMimeType = typeof params.productMimeType === 'string' ? params.productMimeType : undefined;
  const hasHeavy = Boolean(productBase64) || referenceUploads.some((r) => Boolean(r.base64));

  if (!hasHeavy) {
    return { agentId, params, launchId };
  }

  stashAgentLaunchHeavy(launchId, {
    sceneAssetBank: {},
    referenceUploads,
    productBase64,
    productMimeType,
  });

  const leanParams: Record<string, unknown> = {
    ...params,
    productBase64: undefined,
    productMimeType,
    referenceUploads: referenceUploads.map(({ base64: _b, previewUrl: _p, ...meta }) => ({
      ...meta,
      base64: '',
      previewUrl: undefined,
    })),
  };

  return { agentId, params: leanParams, launchId };
}
