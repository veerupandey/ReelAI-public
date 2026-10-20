/** Normalize legacy ad-agent file URLs to current shell layout. */
export const normalizeAdAgentFileUrl = (raw?: string): string => {
  if (!raw) return '';
  try {
    const u = new URL(raw);
    if (u.origin !== 'http://localhost:3721' && u.origin !== 'http://127.0.0.1:3721') return raw;
    if (!u.pathname.startsWith('/files/')) return raw;
    const parts = u.pathname.slice('/files/'.length).split('/').filter(Boolean);
    if (parts.length < 4) return raw;
    const knownFlows = new Set(['ad-agent', 'agent', 'autopilot', 'agent-creator']);
    if (knownFlows.has(parts[2])) return raw;
    const [brand, product, sessionId, ...rest] = parts;
    if (!rest.length) return raw;
    u.pathname = `/files/${[brand, product, 'ad-agent', sessionId, ...rest].join('/')}`;
    return u.toString();
  } catch {
    return raw;
  }
};

export const DETAILS_STORAGE_KEY = 'reelai.agentConsole.showDetails';
