import { CreationMode, ReelPlan, ReelScript } from '../types';

export interface LocalUser {
    id: string;
    email?: string;
    user_metadata?: {
        full_name?: string;
        avatar_url?: string;
    };
}

export interface LocalSession {
    user: LocalUser;
    access_token: string;
}

export interface UserProfileRecord {
    id: string;
    display_name?: string;
    avatar_url?: string;
    plan_tier?: string;
    created_at?: string;
    updated_at?: string;
}

export interface UserSessionRecord {
    id: string;
    user_id: string;
    event: 'login' | 'logout';
    metadata?: Record<string, any>;
    created_at: string;
}

export interface ReelHistoryEntry {
    id: string;
    user_id: string;
    created_at: string;
    mode: CreationMode | string;
    prompt?: string;
    topic?: string;
    vibe?: string;
    scenes?: number;
    status: 'plan_saved' | 'assets_generated' | 'error';
    metadata?: Record<string, any>;
}

export interface ProjectSession {
    id?: string;
    user_id?: string;
    name: string;
    created_at?: string;
    updated_at?: string;
    state: Record<string, any>;
}

const HISTORY_KEY = 'reel_history';
const PROJECT_SESSIONS_KEY = 'project_sessions';

const readJson = <T>(key: string, fallback: T): T => {
    try {
        const raw = localStorage.getItem(key);
        if (!raw) return fallback;
        return JSON.parse(raw) as T;
    } catch (err) {
        console.warn(`[userDataService] Failed to parse ${key}`, err);
        return fallback;
    }
};

const writeJson = (key: string, value: unknown) => {
    try {
        localStorage.setItem(key, JSON.stringify(value));
    } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            console.warn(`[userDataService] LocalStorage quota exceeded for ${key}.`);
        } else {
            console.error(`[userDataService] Failed to persist ${key}`, e);
        }
    }
};

export const upsertUserProfile = async (session: LocalSession | null) => {
    if (!session?.user) return null;
    return {
        id: session.user.id,
        display_name: session.user.user_metadata?.full_name || session.user.email || 'Creator',
        avatar_url: session.user.user_metadata?.avatar_url || undefined,
        plan_tier: 'local',
    } as UserProfileRecord;
};

export const fetchUserProfile = async (userId: string) => {
    return {
        id: userId,
        display_name: 'Local Creator',
        plan_tier: 'local',
    } as UserProfileRecord;
};

export const recordUserSessionEvent = async (
    _userId: string,
    _event: 'login' | 'logout',
    _metadata?: Record<string, any>,
) => {
    // Local-only mode: no remote session ledger.
};

export const fetchUserSessions = async (_userId: string, _limit = 30) => {
    return [] as UserSessionRecord[];
};

export const requestSessionLogout = async (userId: string, metadata?: Record<string, any>) => {
    return recordUserSessionEvent(userId, 'logout', { reason: 'manual_revoke', ...metadata });
};

interface SaveHistoryParams {
    userId: string;
    status: 'plan_saved' | 'assets_generated' | 'error';
    mode: CreationMode | string;
    prompt?: string;
    reelPlan?: ReelPlan | null;
    script?: ReelScript | null;
    metadata?: Record<string, any>;
}

export const saveReelHistoryEntry = async ({
    userId,
    status,
    mode,
    prompt,
    reelPlan,
    script,
    metadata,
}: SaveHistoryParams) => {
    const entry: ReelHistoryEntry = {
        id: `local-${Date.now()}`,
        user_id: userId,
        created_at: new Date().toISOString(),
        status,
        mode,
        prompt,
        topic: reelPlan?.topic,
        vibe: reelPlan?.vibe,
        scenes: reelPlan?.scenes.length,
        metadata: {
            ...metadata,
            plan: reelPlan,
            script: script
                ? {
                    title: script.title,
                    hook: script.hook,
                    body: script.body,
                    callToAction: script.callToAction,
                    fullText: script.fullText,
                    segments: script.segments,
                    segmentPlans: script.segmentPlans,
                    musicSuggestion: script.musicSuggestion,
                }
                : undefined,
        },
    };
    const history = readJson<ReelHistoryEntry[]>(HISTORY_KEY, []);
    history.unshift(entry);
    writeJson(HISTORY_KEY, history.slice(0, 50));
    return entry;
};

export const fetchReelHistory = async (userId: string, limit = 20) => {
    const history = readJson<ReelHistoryEntry[]>(HISTORY_KEY, []);
    return history.filter((entry) => entry.user_id === userId).slice(0, limit);
};

const getLocalProjectSessions = (): ProjectSession[] =>
    readJson<ProjectSession[]>(PROJECT_SESSIONS_KEY, []);

const persistLocalProjectSessions = (sessions: ProjectSession[]) => {
    try {
        localStorage.setItem(PROJECT_SESSIONS_KEY, JSON.stringify(sessions));
    } catch (e) {
        if (e instanceof DOMException && e.name === 'QuotaExceededError') {
            console.warn('[userDataService] LocalStorage quota exceeded. Trimming older sessions.');
            if (sessions.length > 3) {
                persistLocalProjectSessions(sessions.slice(-3));
            }
        } else {
            console.error('[userDataService] Failed to persist sessions', e);
        }
    }
};

const mergeProjectSessions = (sessions: ProjectSession[]): ProjectSession[] => {
    const byId = new Map<string, ProjectSession>();
    sessions.forEach((session) => {
        if (!session) return;
        const key = session.id || `${session.name}-${session.created_at || session.updated_at || ''}`;
        if (!key) return;
        if (!byId.has(key)) {
            byId.set(key, session);
        }
    });
    return Array.from(byId.values()).sort((a, b) => {
        const aTime = new Date(a.updated_at || a.created_at || 0).getTime();
        const bTime = new Date(b.updated_at || b.created_at || 0).getTime();
        return bTime - aTime;
    });
};

export const saveProjectSession = async (
    userId: string,
    sessionName: string,
    appState: Record<string, any>,
): Promise<ProjectSession | null> => {
    const sessions = getLocalProjectSessions();
    const newSession: ProjectSession = {
        id: Date.now().toString(),
        user_id: userId,
        name: sessionName,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
        state: appState,
    };
    sessions.push(newSession);
    persistLocalProjectSessions(sessions);
    return newSession;
};

export const fetchProjectSessions = async (userId: string, limit = 20): Promise<ProjectSession[]> => {
    const localSessions = getLocalProjectSessions().filter((s) => s.user_id === userId);
    return mergeProjectSessions(localSessions).slice(0, limit);
};

export const deleteProjectSession = async (sessionId: string): Promise<void> => {
    const sessions = getLocalProjectSessions();
    persistLocalProjectSessions(sessions.filter((s) => s.id !== sessionId));
};

export const updateProjectSession = async (
    sessionId: string,
    updates: Partial<ProjectSession>,
): Promise<void> => {
    const sessions = getLocalProjectSessions();
    const updated = sessions.map((s) =>
        s.id === sessionId ? { ...s, ...updates, updated_at: new Date().toISOString() } : s,
    );
    persistLocalProjectSessions(updated);
};
